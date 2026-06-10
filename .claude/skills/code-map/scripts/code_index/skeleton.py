"""Skeleton (signature-only) views so agents can navigate god files by symbol slice."""

import os


def render(record):
    lines = [
        f"# Skeleton: {record['path']} ({record['loc']} LOC)",
        '',
        'Symbol slices — read one with Read(offset=START, limit=END-START+1).',
        '',
    ]
    for sym in record['symbols']:
        lines.extend(_sym_lines(sym, 0))
    return '\n'.join(lines) + '\n'


def _sym_lines(sym, depth):
    pad = '  ' * depth
    out = [f"{pad}- `{sym['signature']}`  # L{sym['start']}-L{sym['end']}"]
    if sym.get('doc'):
        out.append(f"{pad}  {sym['doc']}")
    for child in sym.get('children', []):
        out.extend(_sym_lines(child, depth + 1))
    return out


def write(record, skeleton_dir, out_dir):
    """Write the skeleton file; return its path relative to the graph's directory."""
    path = os.path.join(skeleton_dir, record['path'] + '.skel.md')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(render(record))
    return os.path.relpath(path, out_dir).replace(os.sep, '/')
