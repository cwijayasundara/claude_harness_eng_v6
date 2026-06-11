"""JS/JSX/TS/TSX extraction via tree-sitter prebuilt wheels (no compilers)."""

import re

from tree_sitter import Language, Parser

HOOK_RE = re.compile(r'^use[A-Z]')
JSX_TYPES = ('jsx_element', 'jsx_self_closing_element', 'jsx_fragment')
ELEMENT_TYPES = ('jsx_self_closing_element', 'jsx_opening_element')
FN_TYPES = ('function_declaration', 'generator_function_declaration',
            'class_declaration', 'abstract_class_declaration')

_PARSERS = {}


def _grammar(key):
    if key == '.ts':
        import tree_sitter_typescript as ts
        return Language(ts.language_typescript())
    if key == '.tsx':
        import tree_sitter_typescript as ts
        return Language(ts.language_tsx())
    import tree_sitter_javascript as js
    return Language(js.language())


def _parser(ext):
    key = ext if ext in ('.ts', '.tsx') else '.js'
    if key not in _PARSERS:
        _PARSERS[key] = Parser(_grammar(key))
    return _PARSERS[key]


def _text(node):
    return node.text.decode('utf-8', 'replace')


def _walk(node):
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(reversed(n.named_children))


def _bindings(stmt):
    names = []
    clause = next((c for c in stmt.named_children if c.type == 'import_clause'), None)
    if clause is None:
        return names
    for n in _walk(clause):
        if n.type == 'identifier' and n.parent.type in ('import_clause', 'namespace_import'):
            names.append(_text(n))
        elif n.type == 'import_specifier':
            target = n.child_by_field_name('alias') or n.child_by_field_name('name')
            if target is not None:
                names.append(_text(target))
    return names


def _import_entry(stmt):
    source = next((c for c in stmt.named_children if c.type == 'string'), None)
    if source is None:
        return None
    kind = 'type' if any(c.type == 'type' for c in stmt.children) else 'value'
    return {
        'raw': _text(source).strip('\'"'),
        'names': _bindings(stmt),
        'kind': kind,
        'line': stmt.start_point[0] + 1,
    }


def _declared(node):
    if node.type != 'export_statement':
        return node
    return node.child_by_field_name('declaration') or node.child_by_field_name('value')


def _symbol_nodes(root):
    for child in root.named_children:
        decl = _declared(child)
        if decl is None:
            continue
        if decl.type in FN_TYPES:
            name = decl.child_by_field_name('name')
            if name is not None:
                yield _text(name), decl
        elif decl.type in ('lexical_declaration', 'variable_declaration'):
            yield from _declarators(decl)


def _declarators(decl):
    for d in decl.named_children:
        if d.type != 'variable_declarator':
            continue
        name = d.child_by_field_name('name')
        value = d.child_by_field_name('value')
        if name is None or value is None:
            continue
        if value.type in ('arrow_function', 'function_expression'):
            yield _text(name), d


def _scan(sym_node):
    has_jsx, hooks = False, set()
    for n in _walk(sym_node):
        if n.type in JSX_TYPES:
            has_jsx = True
        elif n.type == 'call_expression':
            fn = n.child_by_field_name('function')
            if fn is not None and fn.type == 'identifier' and HOOK_RE.match(_text(fn)):
                hooks.add(_text(fn))
    return has_jsx, sorted(hooks)


def _element_name(node):
    name = node.child_by_field_name('name')
    if name is not None and name.type == 'identifier':
        return _text(name)
    return None


def _route_from(element):
    path, component = None, None
    for attr in (c for c in element.named_children if c.type == 'jsx_attribute'):
        key = _text(attr.named_children[0]) if attr.named_children else ''
        if key == 'path':
            value = next((x for x in _walk(attr) if x.type == 'string'), None)
            if value is not None:
                path = _text(value).strip('\'"')
        elif key == 'element':
            inner = next((x for x in _walk(attr) if x.type in ELEMENT_TYPES), None)
            if inner is not None:
                component = _element_name(inner)
    if path and component:
        return {'path': path, 'component': component}
    return None


def _renders_and_routes(root, symbols):
    renders, routes = [], []
    spans = [(s['name'], s['start'], s['end']) for s in symbols]
    for n in _walk(root):
        if n.type not in ELEMENT_TYPES:
            continue
        name = _element_name(n)
        if not name or not name[0].isupper():
            continue
        line = n.start_point[0] + 1
        owner = next((s for s, a, b in spans if a <= line <= b), None)
        renders.append({'symbol_from': owner, 'name': name, 'line': line})
        if name == 'Route':
            route = _route_from(n)
            if route:
                routes.append(route)
    return renders, routes


def _symbol_record(name, node):
    has_jsx, hooks = _scan(node)
    if has_jsx and name[0].isupper():
        kind = 'component'
    elif node.type in ('class_declaration', 'abstract_class_declaration'):
        kind = 'class'
    else:
        kind = 'function'
    sym = {
        'name': name, 'kind': kind,
        'start': node.start_point[0] + 1, 'end': node.end_point[0] + 1,
        'signature': _text(node).split('\n', 1)[0].rstrip(' {'),
    }
    if kind == 'component' and hooks:
        sym['hooks'] = hooks
    return sym


def extract(content, rel, ext):
    """Return {symbols, imports, renders, routes} for one JS/TS/JSX/TSX file."""
    root = _parser(ext).parse(content.encode('utf-8')).root_node
    symbols = [_symbol_record(name, node) for name, node in _symbol_nodes(root)]
    imports = []
    for stmt in (c for c in root.named_children if c.type == 'import_statement'):
        entry = _import_entry(stmt)
        if entry:
            imports.append(entry)
    renders, routes = _renders_and_routes(root, symbols)
    return {'symbols': symbols, 'imports': imports, 'renders': renders, 'routes': routes}
