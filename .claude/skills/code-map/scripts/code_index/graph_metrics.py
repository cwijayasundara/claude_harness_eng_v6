"""Graph metrics: fan-in/out, hubs, and Tarjan SCC cycle detection (iterative)."""


def _instability(fan_in, fan_out):
    total = fan_in + fan_out
    return 0 if total == 0 else round(fan_out / total, 3)


def _adjacency(node_ids, edges):
    fan_in, fan_out, adj = {}, {}, {}
    internal = external = 0
    for e in edges:
        if e['target'].startswith('ext:'):
            external += 1
            continue
        if e.get('import_kind') == 'type':
            continue
        if e['target'] not in node_ids or e['source'] not in node_ids:
            continue
        internal += 1
        fan_in[e['target']] = fan_in.get(e['target'], 0) + 1
        fan_out[e['source']] = fan_out.get(e['source'], 0) + 1
        adj.setdefault(e['source'], set()).add(e['target'])
    return fan_in, fan_out, adj, internal, external


def _hubs(node_ids, fan_in, fan_out):
    hubs = []
    for nid in node_ids:
        fi, fo = fan_in.get(nid, 0), fan_out.get(nid, 0)
        if fi + fo == 0:
            continue
        hubs.append({'id': nid, 'fan_in': fi, 'fan_out': fo,
                     'instability': _instability(fi, fo)})
    hubs.sort(key=lambda h: (-h['fan_in'], -h['fan_out']))
    return hubs


def _strongconnect(start, adj, state):
    index, lowlink, on_stack, stack, cycles, counter = state
    work = [(start, iter(sorted(adj.get(start, ()))))]
    index[start] = lowlink[start] = counter[0]
    counter[0] += 1
    stack.append(start)
    on_stack.add(start)
    while work:
        v, it = work[-1]
        child = next(it, None)
        if child is None:
            work.pop()
            _close_component(v, index, lowlink, on_stack, stack, cycles)
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[v])
        elif child not in index:
            index[child] = lowlink[child] = counter[0]
            counter[0] += 1
            stack.append(child)
            on_stack.add(child)
            work.append((child, iter(sorted(adj.get(child, ())))))
        elif child in on_stack:
            lowlink[v] = min(lowlink[v], index[child])


def _close_component(v, index, lowlink, on_stack, stack, cycles):
    if lowlink[v] != index[v]:
        return
    component = []
    while True:
        w = stack.pop()
        on_stack.discard(w)
        component.append(w)
        if w == v:
            break
    if len(component) > 1:
        cycles.append(sorted(component))


def _cycles(adj):
    state = ({}, {}, set(), [], [], [0])
    for v in sorted(adj):
        if v not in state[0]:
            _strongconnect(v, adj, state)
    return state[4]


def compute(nodes, edges):
    """Metrics block for the code-graph: files, edges, externals, cycles, hubs."""
    node_ids = {n['id'] for n in nodes}
    fan_in, fan_out, adj, internal, external = _adjacency(node_ids, edges)
    return {
        'files': len(nodes),
        'edges': internal,
        'external_imports': external,
        'cycles': _cycles(adj),
        'hubs': _hubs(node_ids, fan_in, fan_out)[:25],
    }
