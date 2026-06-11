"""Resolution of raw imports/calls/renders into internal graph edges."""

import json
import os

PREFIX = {'python': 'py', 'node': 'js', 'typescript': 'ts'}
JS_EXTS = ('.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs')


def node_id(language, rel):
    return f'{PREFIX[language]}:{rel}'


def load_aliases(root):
    """Read tsconfig.json compilerOptions.paths into (prefix, target) pairs."""
    try:
        with open(os.path.join(root, 'tsconfig.json'), encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    opts = data.get('compilerOptions', {})
    base = opts.get('baseUrl', '.')
    pairs = []
    for pattern, targets in opts.get('paths', {}).items():
        if not targets:
            continue
        target = os.path.normpath(os.path.join(base, targets[0].rstrip('*')))
        pairs.append((pattern.rstrip('*'), target.replace(os.sep, '/').lstrip('./')))
    return pairs


def register(maps, rel, lang):
    """Add one file to the resolution maps (also used for incremental patching)."""
    maps['languages'][rel] = lang
    if lang == 'python':
        mod = rel[:-3].replace('/', '.')
        if mod.endswith('.__init__'):
            mod = mod[: -len('.__init__')]
        maps['py_modules'][mod] = rel
    else:
        maps['js_stems'][rel.rsplit('.', 1)[0]] = rel


def build_maps(paths_by_language):
    """paths_by_language: iterable of (rel_path, language)."""
    maps = {'py_modules': {}, 'js_stems': {}, 'languages': {}}
    for rel, lang in paths_by_language:
        register(maps, rel, lang)
    return maps


def _resolve_py(raw, src_rel, py_modules):
    if raw.startswith('.'):
        level = len(raw) - len(raw.lstrip('.'))
        parts = src_rel.split('/')[:-1]
        if level > 1:
            parts = parts[: len(parts) - (level - 1)]
        tail = raw.lstrip('.')
        mod = '.'.join(parts + ([tail] if tail else []))
    else:
        mod = raw
    while mod:
        if mod in py_modules:
            return py_modules[mod]
        mod = mod.rpartition('.')[0]
    return None


def _resolve_js(raw, src_rel, js_stems, aliases):
    candidates = []
    if raw.startswith('.'):
        joined = os.path.normpath(os.path.join(os.path.dirname(src_rel), raw))
        candidates.append(joined.replace(os.sep, '/'))
    else:
        for prefix, target in aliases:
            if raw.startswith(prefix):
                candidates.append(f'{target}/{raw[len(prefix):]}'.replace('//', '/'))
    for cand in candidates:
        stem = cand.rsplit('.', 1)[0] if cand.endswith(JS_EXTS) else cand
        for key in (stem, f'{cand}/index'):
            if key in js_stems:
                return js_stems[key]
    return None


def _import_edges(rel, lang, data, maps, aliases):
    src = node_id(lang, rel)
    edges, name_targets = [], {}
    for imp in data.get('imports', []):
        if lang == 'python':
            target_rel = _resolve_py(imp['raw'], rel, maps['py_modules'])
        else:
            target_rel = _resolve_js(imp['raw'], rel, maps['js_stems'], aliases)
        if target_rel:
            target = node_id(maps['languages'][target_rel], target_rel)
            for name in imp.get('names', []):
                name_targets[name] = target
        else:
            target = f"ext:{imp['raw']}"
        edge = {'source': src, 'target': target, 'kind': 'imports',
                'evidence': f"{rel}:{imp['line']} import {imp['raw']}"}
        if imp.get('kind') == 'type':
            edge['import_kind'] = 'type'
        edges.append(edge)
    return edges, name_targets


def _symbol_edges(rel, src, kind, items, name_targets):
    edges, seen = [], set()
    for item in items:
        target = name_targets.get(item['name'])
        if not target or target == src:
            continue
        key = (target, item.get('symbol_from'), item['name'])
        if kind == 'renders' and key in seen:
            continue
        seen.add(key)
        edges.append({
            'source': src, 'target': target, 'kind': kind,
            'symbol_from': item.get('symbol_from'), 'symbol_to': item['name'],
            'confidence': 'extracted',
            'evidence': f"{rel}:{item['line']} {kind} {item['name']}",
        })
    return edges


def edges_for(rel, lang, data, maps, aliases):
    """All graph edges originating from one file's extraction data."""
    src = node_id(lang, rel)
    edges, name_targets = _import_edges(rel, lang, data, maps, aliases)
    edges += _symbol_edges(rel, src, 'calls', data.get('calls', []), name_targets)
    edges += _symbol_edges(rel, src, 'renders', data.get('renders', []), name_targets)
    return edges
