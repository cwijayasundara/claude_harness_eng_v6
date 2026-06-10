"""Python extraction for the code index — stdlib ast only, zero dependencies."""

import ast

HTTP_METHODS = {'get', 'post', 'put', 'delete', 'patch', 'head', 'options'}
FUNC_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef)


def _signature(lines, node):
    return lines[node.lineno - 1].strip()


def _route(node):
    for dec in getattr(node, 'decorator_list', []):
        if not (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)):
            continue
        attr = dec.func.attr.lower()
        if attr not in HTTP_METHODS or not dec.args:
            continue
        first = dec.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return {'method': attr.upper(), 'path': first.value}
    return None


def _doc(node):
    text = ast.get_docstring(node)
    return text.strip().splitlines()[0] if text else None


def _symbol(node, lines, kind):
    sym = {
        'name': node.name, 'kind': kind,
        'start': node.lineno, 'end': node.end_lineno,
        'signature': _signature(lines, node),
    }
    doc = _doc(node)
    if doc:
        sym['doc'] = doc
    route = _route(node)
    if route:
        sym['route'] = route
    return sym


def _class_symbol(node, lines):
    sym = _symbol(node, lines, 'class')
    children = [_symbol(c, lines, 'method') for c in node.body if isinstance(c, FUNC_TYPES)]
    if children:
        sym['children'] = children
    return sym


def _imports(tree):
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.append({'raw': alias.name, 'names': [], 'kind': 'value', 'line': node.lineno})
        elif isinstance(node, ast.ImportFrom):
            raw = '.' * node.level + (node.module or '')
            names = [a.asname or a.name for a in node.names]
            out.append({'raw': raw, 'names': names, 'kind': 'value', 'line': node.lineno})
    return out


def _owned_functions(tree):
    for node in tree.body:
        if isinstance(node, FUNC_TYPES):
            yield node, node.name
        elif isinstance(node, ast.ClassDef):
            for child in node.body:
                if isinstance(child, FUNC_TYPES):
                    yield child, f'{node.name}.{child.name}'


def _calls(tree, local_defs):
    out = []
    for owner, qual in _owned_functions(tree):
        for node in ast.walk(owner):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
                continue
            if node.func.id in local_defs:
                continue
            out.append({'symbol_from': qual, 'name': node.func.id, 'line': node.lineno})
    return out


def extract(content, rel):
    """Return {symbols, imports, calls} for one Python source file."""
    lines = content.splitlines()
    tree = ast.parse(content, filename=rel)
    symbols, local_defs = [], set()
    for node in tree.body:
        if isinstance(node, FUNC_TYPES):
            symbols.append(_symbol(node, lines, 'function'))
            local_defs.add(node.name)
        elif isinstance(node, ast.ClassDef):
            symbols.append(_class_symbol(node, lines))
            local_defs.add(node.name)
    return {
        'symbols': symbols,
        'imports': _imports(tree),
        'calls': _calls(tree, local_defs),
    }
