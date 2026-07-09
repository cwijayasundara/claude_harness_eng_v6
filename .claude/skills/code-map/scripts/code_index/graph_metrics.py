"""Graph metrics: fan-in/out, hubs, and Tarjan SCC cycle detection (iterative)."""

# Same unstable-hub thresholds hooks/lib/drift.js's UNSTABLE_FAN_IN /
# UNSTABLE_INSTABILITY constants use (coupling-report.md's unstableSection,
# coupling-gate.js's ratchet). Keep these two implementations in lockstep —
# a drift here silently changes what counts as unstable in only one runtime.
UNSTABLE_FAN_IN = 5
UNSTABLE_INSTABILITY = 0.8


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


# Gap G26: `hubs` (above) is truncated to the top 25 for the human-facing
# coupling report — a reasonable display cap on its own terms, but consumers
# that run a threshold-based unstable-hub CHECK (coupling-gate.js's ratchet,
# drift.js's staleness tracking, agent-readiness's modularity-freshness
# pillar, record-modularity-review.js's marker) were reusing that same
# truncated list, so a real unstable hub ranked 26th+ by fan-in was
# structurally invisible to all of them. This sibling computation applies the
# identical threshold test over the FULL, uncapped hub list so those
# consumers have an uncapped source to read instead. `hubs` itself and its
# top-25 truncation are unchanged — this is additive, not a fix to `_hubs()`.
def _unstable_hubs(all_hubs):
    return [h for h in all_hubs
            if h['fan_in'] >= UNSTABLE_FAN_IN and h['instability'] >= UNSTABLE_INSTABILITY]


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
    all_hubs = _hubs(node_ids, fan_in, fan_out)
    return {
        'files': len(nodes),
        'edges': internal,
        'external_imports': external,
        'cycles': _cycles(adj),
        'hubs': all_hubs[:25],
        'unstable_hubs': _unstable_hubs(all_hubs),
    }
