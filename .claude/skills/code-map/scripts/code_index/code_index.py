#!/usr/bin/env python3
"""AST code indexer — Python (stdlib ast) + React/JS/TS (tree-sitter wheels).

Writes the harness code-graph.json (backward-compatible nodes/edges/metrics/meta)
extended with per-file symbol records (line ranges, signatures, routes, hooks),
emits skeleton views for god files, and supports --files incremental patching
so hooks can keep the graph fresh after every edit.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import compiled_index
import graph_metrics
import map_render
import py_index
import resolve
import skeleton
import ts_index

LANG_BY_EXT = {
    '.py': 'python',
    '.js': 'node', '.jsx': 'node', '.mjs': 'node', '.cjs': 'node',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.java': 'java', '.cs': 'csharp', '.go': 'go',
}
COMPILED_LANGS = ('java', 'csharp', 'go')
EXCLUDES = {
    'node_modules', '.venv', 'venv', 'env', 'dist', 'build', 'target',
    'vendor', '.git', '__pycache__', '.mypy_cache', '.ruff_cache',
    '.next', '.nuxt', '.pytest_cache', '.tox', 'out', 'bin', 'obj',
    'coverage', '.coverage', 'htmlcov',
}
MAX_BYTES = 1_500_000


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', default='.')
    p.add_argument('--out', default='specs/brownfield/code-graph.json')
    p.add_argument('--skeleton-dir', default=None)
    p.add_argument('--skeleton-threshold', type=int, default=1500)
    p.add_argument('--files', nargs='+', default=None,
                   help='Patch only these root-relative files into an existing graph.')
    p.add_argument('--render-map', default=None, metavar='GRAPH_JSON',
                   help='Render a codebase map from an existing graph to --out.')
    p.add_argument('--map-budget', type=int, default=4000,
                   help='Token budget for --render-map output.')
    return p.parse_args(argv)


def walk(root):
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDES and not d.startswith('.')]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext in LANG_BY_EXT:
                rel = os.path.relpath(os.path.join(dirpath, name), root)
                found.append(rel.replace(os.sep, '/'))
    return sorted(found)


def _extract(lang, content, rel, ext, warnings):
    empty = {'symbols': [], 'imports': [], 'calls': [], 'renders': [], 'routes': []}
    try:
        if lang == 'python':
            return py_index.extract(content, rel)
        if lang in COMPILED_LANGS:
            return compiled_index.extract(content, rel, lang)
        return ts_index.extract(content, rel, ext)
    except (SyntaxError, ValueError) as err:
        warnings.append(f'{rel}: parse failed — {err}')
    except ImportError as err:
        # Wheel for this grammar not installed — the file keeps its node but
        # loses symbol records. init.sh installs the wheels; warn loudly here.
        warnings.append(f'{rel}: tree-sitter wheel missing ({err}) — '
                        f'pip install tree-sitter-java tree-sitter-c-sharp tree-sitter-go')
    return empty


def index_file(root, rel, warnings):
    ext = os.path.splitext(rel)[1].lower()
    lang = LANG_BY_EXT[ext]
    with open(os.path.join(root, rel), 'rb') as fh:
        raw = fh.read()
    content = raw.decode('utf-8', 'replace')
    record = {
        'path': rel,
        'hash': 'sha256:' + hashlib.sha256(raw).hexdigest(),
        'loc': len(content.splitlines()),
        'language': lang,
        'symbols': [],
    }
    if len(raw) > MAX_BYTES:
        warnings.append(f'{rel}: skipped symbol extraction ({len(raw)} bytes > {MAX_BYTES})')
        data = {'symbols': [], 'imports': [], 'calls': [], 'renders': [], 'routes': []}
        return record, data
    data = _extract(lang, content, rel, ext, warnings)
    record['symbols'] = data['symbols']
    if data.get('package'):
        record['package'] = data['package']
    if data.get('routes'):
        record['routes'] = data['routes']
    return record, data


def make_node(record):
    return {
        'id': resolve.node_id(record['language'], record['path']),
        'kind': 'file',
        'language': record['language'],
        'path': record['path'],
        'symbols': sorted(s['name'] for s in record['symbols']),
    }


def maybe_skeleton(record, args):
    if not args.skeleton_dir or record['loc'] < args.skeleton_threshold:
        return
    out_dir = os.path.dirname(os.path.abspath(args.out))
    record['skeleton'] = skeleton.write(record, args.skeleton_dir, out_dir)


def assemble(root, indexed, args, warnings):
    maps = resolve.build_maps(rec for rec, _ in indexed)
    maps['go_module'] = resolve.load_go_module(root)
    aliases = resolve.load_aliases(root)
    nodes, files, edges, lang_counts = [], [], [], {}
    for record, data in indexed:
        maybe_skeleton(record, args)
        nodes.append(make_node(record))
        files.append(record)
        edges.extend(resolve.edges_for(record['path'], record['language'], data, maps, aliases))
        lang_counts[record['language']] = lang_counts.get(record['language'], 0) + 1
    return {
        'nodes': nodes,
        'edges': edges,
        'files': files,
        'metrics': graph_metrics.compute(nodes, edges),
        'meta': {
            'producer': 'vendored-ast',
            'languages': lang_counts,
            'warnings': warnings,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'root': os.path.abspath(root),
        },
    }


def drop_stale_inbound(graph, nid, old_symbols, new_symbols):
    """Drop call/render edges from other files that target symbols the patched
    file no longer declares — without this, renames/removals leave the inbound
    half of the graph stale. Only symbols present before and gone now are
    dropped: edges to module-level bindings (engine, router, app) were never
    in the symbol list and must survive."""
    dropped = old_symbols - new_symbols
    if not dropped:
        return
    graph['edges'] = [
        e for e in graph['edges']
        if not (e['target'] == nid and e['source'] != nid
                and e.get('kind') in ('calls', 'renders')
                and e.get('symbol_to') in dropped)
    ]


def splice(graph, record, data, maps, aliases):
    """Replace one file's node and outbound edges; prune stale inbound edges."""
    rel = record['path']
    nid = resolve.node_id(record['language'], rel)
    node = make_node(record)
    old = next((n for n in graph['nodes'] if n['id'] == nid), None)
    graph['nodes'] = [n for n in graph['nodes'] if n['id'] != nid] + [node]
    graph['edges'] = ([e for e in graph['edges'] if e['source'] != nid]
                      + resolve.edges_for(rel, record['language'], data, maps, aliases))
    drop_stale_inbound(graph, nid, set(old['symbols']) if old else set(),
                       set(node['symbols']))


def patch(root, graph, rels, args, warnings):
    """Re-extract only `rels`, splice their records/edges into the existing graph."""
    by_path = {f['path']: f for f in graph.get('files', [])}
    maps = resolve.build_maps(graph.get('files', []))
    maps['go_module'] = resolve.load_go_module(root)
    aliases = resolve.load_aliases(root)
    # Extract and register every patched file BEFORE resolving edges, so files
    # created in the same batch resolve to internal nodes instead of ext:.
    extracted = []
    for rel in rels:
        record, data = index_file(root, rel, warnings)
        maybe_skeleton(record, args)
        resolve.register(maps, record)
        extracted.append((record, data))
    for record, data in extracted:
        by_path[record['path']] = record
        splice(graph, record, data, maps, aliases)
    graph['files'] = list(by_path.values())
    graph['metrics'] = graph_metrics.compute(graph['nodes'], graph['edges'])
    graph['meta']['warnings'] = warnings
    graph['meta']['generated_at'] = datetime.now(timezone.utc).isoformat()
    return graph


def write_out(graph, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(graph, fh, indent=2)
    meta_path = os.path.splitext(out)[0] + '.meta.json'
    with open(meta_path, 'w', encoding='utf-8') as fh:
        json.dump(graph['meta'], fh, indent=2)


def render_map(args):
    with open(args.render_map, encoding='utf-8') as fh:
        graph = json.load(fh)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(map_render.render(graph, args.map_budget))
    sys.stderr.write(f'Wrote {args.out}\n')
    return 0


def main(argv):
    args = parse_args(argv)
    if args.render_map:
        return render_map(args)
    root = os.path.abspath(args.root)
    warnings = []
    if args.files:
        with open(args.out, encoding='utf-8') as fh:
            graph = json.load(fh)
        graph = patch(root, graph, args.files, args, warnings)
    else:
        indexed = [index_file(root, rel, warnings) for rel in walk(root)]
        graph = assemble(root, indexed, args, warnings)
    write_out(graph, args.out)
    sys.stderr.write(
        f"Wrote {args.out} ({len(graph['nodes'])} nodes, "
        f"{graph['metrics']['edges']} internal edges, "
        f"{len(graph['metrics']['cycles'])} cycles)\n"
    )
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
