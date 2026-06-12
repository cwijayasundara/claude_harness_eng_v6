"""Resolution of raw imports/calls/renders into internal graph edges."""

import json
import os
import re
import sys

PREFIX = {'python': 'py', 'node': 'js', 'typescript': 'ts',
          'java': 'java', 'csharp': 'cs', 'go': 'go'}
JS_EXTS = ('.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs')
COMPILED = ('java', 'csharp', 'go')


def node_id(language, rel):
    return f'{PREFIX[language]}:{rel}'


def _strip_jsonc(text):
    """Remove JSONC comments and trailing commas so json.loads can parse the result.

    Strips /* ... */ block comments, then // line comments outside strings
    (conservative: only when preceded by whitespace or line start, so that
    https:// inside string values is preserved).  Removes trailing commas
    before ] or }.  Limitation: does not handle // inside multi-line strings.
    """
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    text = re.sub(r'(?m)(?:^|(?<=\s))//[^\n]*', '', text)
    return re.sub(r',\s*([}\]])', r'\1', text)


def _parse_aliases(data, base):
    """Extract (prefix, target) pairs from compilerOptions.paths."""
    pairs = []
    for pattern, targets in data.get('compilerOptions', {}).get('paths', {}).items():
        if not targets:
            continue
        target = os.path.normpath(os.path.join(base, targets[0].rstrip('*')))
        pairs.append((pattern.rstrip('*'), target.replace(os.sep, '/').lstrip('./')))
    return pairs


def load_aliases(root):
    """Read tsconfig.json compilerOptions.paths into (prefix, target) pairs.

    Handles JSONC (comments + trailing commas) used by Next.js and Vite configs.
    On parse failure, prints a warning to stderr so the failure is discoverable.
    """
    tsconfig_path = os.path.join(root, 'tsconfig.json')
    try:
        with open(tsconfig_path, encoding='utf-8') as fh:
            raw = fh.read()
    except OSError:
        return []
    try:
        data = json.loads(_strip_jsonc(raw))
    except ValueError as exc:
        sys.stderr.write(f'resolve: tsconfig.json parse failed after JSONC strip: {exc}\n')
        return []
    base = data.get('compilerOptions', {}).get('baseUrl', '.')
    return _parse_aliases(data, base)


def _symbol_names(record):
    return [s if isinstance(s, str) else s['name'] for s in record.get('symbols', [])]


def _register_compiled(maps, rel, lang, record):
    package = record.get('package')
    if lang == 'java' and package:
        for name in _symbol_names(record):
            maps['fq_types'][f'{package}.{name}'] = rel
    elif lang == 'csharp' and package:
        maps['namespaces'].setdefault(package, []).append(rel)
    elif lang == 'go':
        pkg_dir = os.path.dirname(rel).replace(os.sep, '/') or '.'
        maps['go_pkgs'].setdefault(pkg_dir, []).append(rel)


def register(maps, record):
    """Add one file record (path/language[/package/symbols]) to the maps."""
    rel, lang = record['path'], record['language']
    maps['languages'][rel] = lang
    if lang == 'python':
        mod = rel[:-3].replace('/', '.')
        if mod.endswith('.__init__'):
            mod = mod[: -len('.__init__')]
        maps['py_modules'][mod] = rel
    elif lang in COMPILED:
        _register_compiled(maps, rel, lang, record)
    else:
        maps['js_stems'][rel.rsplit('.', 1)[0]] = rel


def build_maps(records):
    """records: iterable of file records (dicts with path/language[/package/symbols])."""
    maps = {'py_modules': {}, 'js_stems': {}, 'languages': {},
            'fq_types': {}, 'namespaces': {}, 'go_pkgs': {}, 'go_module': None}
    for record in records:
        register(maps, record)
    return maps


def load_go_module(root):
    """Module path from go.mod, used to resolve module-relative Go imports."""
    try:
        with open(os.path.join(root, 'go.mod'), encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('module '):
                    return line.split(None, 1)[1].strip()
    except OSError:
        pass
    return None


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


def _resolve_compiled(raw, lang, maps):
    """Target rels for a Java/C#/Go import. May be several (namespace/package)."""
    if lang == 'java':
        target = maps['fq_types'].get(raw)
        return [target] if target else []
    if lang == 'csharp':
        return list(maps['namespaces'].get(raw, []))
    module = maps.get('go_module')
    if module:
        if raw == module:
            return list(maps['go_pkgs'].get('.', []))
        if raw.startswith(module + '/'):
            return list(maps['go_pkgs'].get(raw[len(module) + 1:], []))
    return []


def _compiled_edges(rel, lang, data, maps):
    src = node_id(lang, rel)
    edges = []
    for imp in data.get('imports', []):
        targets = _resolve_compiled(imp['raw'], lang, maps)
        for target_rel in targets:
            if target_rel == rel:
                continue
            edges.append({
                'source': src, 'target': node_id(maps['languages'][target_rel], target_rel),
                'kind': 'imports', 'evidence': f"{rel}:{imp['line']} import {imp['raw']}",
            })
        if not targets:
            edges.append({'source': src, 'target': f"ext:{imp['raw']}", 'kind': 'imports',
                          'evidence': f"{rel}:{imp['line']} import {imp['raw']}"})
    return edges


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
    if lang in COMPILED:
        return _compiled_edges(rel, lang, data, maps)
    src = node_id(lang, rel)
    edges, name_targets = _import_edges(rel, lang, data, maps, aliases)
    edges += _symbol_edges(rel, src, 'calls', data.get('calls', []), name_targets)
    edges += _symbol_edges(rel, src, 'renders', data.get('renders', []), name_targets)
    return edges
