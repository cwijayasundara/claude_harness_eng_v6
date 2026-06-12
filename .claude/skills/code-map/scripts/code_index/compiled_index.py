"""Java/C#/Go extraction via tree-sitter prebuilt wheels (no compilers).

Symbol records (types with method children, line ranges) plus the file's
package/namespace declaration and its imports. Resolution to internal edges
happens in resolve.py using the package metadata captured here. A missing
wheel raises ImportError, which code_index.py downgrades to a warning — the
file still gets a node, just without symbol records.
"""

from tree_sitter import Language, Parser

_PARSERS = {}

JAVA_TYPE_NODES = ('class_declaration', 'interface_declaration',
                   'enum_declaration', 'record_declaration')
CS_TYPE_NODES = ('class_declaration', 'interface_declaration', 'struct_declaration',
                 'enum_declaration', 'record_declaration')
METHOD_NODES = ('method_declaration', 'constructor_declaration')


def _grammar(lang):
    if lang == 'java':
        import tree_sitter_java as tsj
        return Language(tsj.language())
    if lang == 'csharp':
        import tree_sitter_c_sharp as tscs
        return Language(tscs.language())
    import tree_sitter_go as tsg
    return Language(tsg.language())


def _parser(lang):
    if lang not in _PARSERS:
        _PARSERS[lang] = Parser(_grammar(lang))
    return _PARSERS[lang]


def _text(node):
    return node.text.decode('utf-8', 'replace')


def _walk(node):
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(reversed(n.named_children))


def _sym(node, name, kind, children=None):
    record = {
        'name': name, 'kind': kind,
        'start': node.start_point[0] + 1, 'end': node.end_point[0] + 1,
        'signature': _text(node).split('\n', 1)[0].rstrip(' {'),
    }
    if children:
        record['children'] = children
    return record


def _methods(type_node):
    body = type_node.child_by_field_name('body')
    if body is None:
        return []
    out = []
    for child in body.named_children:
        if child.type in METHOD_NODES:
            name = child.child_by_field_name('name')
            if name is not None:
                out.append(_sym(child, _text(name), 'method'))
    return out


def _type_symbols(root, type_nodes):
    """Top-level (non-nested) type declarations with their methods as children."""
    out = []
    for n in _walk(root):
        if n.type not in type_nodes:
            continue
        parent, nested = n.parent, False
        while parent is not None:
            if parent.type in type_nodes:
                nested = True
                break
            parent = parent.parent
        if nested:
            continue
        name = n.child_by_field_name('name')
        if name is not None:
            out.append(_sym(n, _text(name), 'class', _methods(n)))
    return out


def _java(root):
    package, imports = None, []
    for n in root.named_children:
        if n.type == 'package_declaration':
            ident = next((c for c in n.named_children if 'identifier' in c.type), None)
            package = _text(ident) if ident is not None else None
        elif n.type == 'import_declaration':
            raw = _text(n).removeprefix('import').strip().rstrip(';').strip()
            raw = raw.removeprefix('static').strip()
            imports.append({'raw': raw, 'names': [], 'kind': 'value',
                            'line': n.start_point[0] + 1})
    return package, imports, _type_symbols(root, JAVA_TYPE_NODES)


def _cs(root):
    package, imports = None, []
    for n in _walk(root):
        if n.type in ('namespace_declaration', 'file_scoped_namespace_declaration') and package is None:
            name = n.child_by_field_name('name')
            package = _text(name) if name is not None else None
        elif n.type == 'using_directive':
            ident = next((c for c in n.named_children
                          if c.type in ('qualified_name', 'identifier')), None)
            if ident is not None:
                imports.append({'raw': _text(ident), 'names': [], 'kind': 'value',
                                'line': n.start_point[0] + 1})
    return package, imports, _type_symbols(root, CS_TYPE_NODES)


def _go_symbols(root):
    out = []
    for n in root.named_children:
        if n.type in ('function_declaration', 'method_declaration'):
            name = n.child_by_field_name('name')
            if name is not None:
                kind = 'method' if n.type == 'method_declaration' else 'function'
                out.append(_sym(n, _text(name), kind))
        elif n.type == 'type_declaration':
            for spec in (c for c in n.named_children if c.type == 'type_spec'):
                name = spec.child_by_field_name('name')
                if name is not None:
                    out.append(_sym(spec, _text(name), 'type'))
    return out


def _go(root):
    package, imports = None, []
    for n in root.named_children:
        if n.type == 'package_clause':
            ident = next((c for c in n.named_children if c.type == 'package_identifier'), None)
            package = _text(ident) if ident is not None else None
        elif n.type == 'import_declaration':
            for spec in (x for x in _walk(n) if x.type == 'import_spec'):
                lit = spec.child_by_field_name('path')
                if lit is not None:
                    imports.append({'raw': _text(lit).strip('"'), 'names': [],
                                    'kind': 'value', 'line': spec.start_point[0] + 1})
    return package, imports, _go_symbols(root)


def extract(content, rel, lang):
    """Return {symbols, imports, package, calls, renders, routes} for one file."""
    root = _parser(lang).parse(content.encode('utf-8')).root_node
    if lang == 'java':
        package, imports, symbols = _java(root)
    elif lang == 'csharp':
        package, imports, symbols = _cs(root)
    else:
        package, imports, symbols = _go(root)
    return {'symbols': symbols, 'imports': imports, 'package': package,
            'calls': [], 'renders': [], 'routes': []}
