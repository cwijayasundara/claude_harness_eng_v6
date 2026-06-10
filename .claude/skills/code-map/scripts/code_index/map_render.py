"""Token-budgeted markdown codebase map — files ranked by fan-in, real signatures."""

CHARS_PER_TOKEN = 4


def _fan_in_by_path(graph):
    by_id = {h['id']: h['fan_in'] for h in graph['metrics']['hubs']}
    out = {}
    for node in graph['nodes']:
        out[node['path']] = by_id.get(node['id'], 0)
    return out


def _sym_line(sym, depth):
    pad = '  ' * depth
    return f"{pad}- `{sym['signature']}`  # L{sym['start']}-L{sym['end']}"


def _section(record, fan_in):
    lines = [f"## {record['path']}  ({record['language']}, fan-in {fan_in})"]
    if record.get('skeleton'):
        lines.append(f"god file — navigate via `{record['skeleton']}`")
    for route in record.get('routes', []):
        lines.append(f"- route `{route.get('method', '')} {route['path']}`".replace('` ', '`'))
    for sym in record['symbols']:
        lines.append(_sym_line(sym, 0))
        for child in sym.get('children', []):
            lines.append(_sym_line(child, 1))
    return '\n'.join(lines) + '\n\n'


def render(graph, budget_tokens):
    """Render the map, dropping lowest-ranked file sections past the budget."""
    budget = budget_tokens * CHARS_PER_TOKEN
    fan_in = _fan_in_by_path(graph)
    ranked = sorted(graph['files'], key=lambda r: (-fan_in[r['path']], r['path']))
    head = (
        f"# Codebase Map ({graph['metrics']['files']} files, "
        f"generated {graph['meta']['generated_at']})\n\n"
        'Ranked by internal fan-in. `Lstart-Lend` anchors are for '
        'Read(offset=START, limit=END-START+1).\n\n'
    )
    parts, used, omitted = [head], len(head), 0
    for record in ranked:
        section = _section(record, fan_in[record['path']])
        if used + len(section) > budget:
            omitted += 1
            continue
        parts.append(section)
        used += len(section)
    if omitted:
        parts.append(f'_{omitted} file(s) omitted — map budget {budget_tokens} tokens._\n')
    return ''.join(parts)
