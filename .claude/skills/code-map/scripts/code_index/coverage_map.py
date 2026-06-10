#!/usr/bin/env python3
"""Symbol-level coverage verdicts — joins coverage data with code-graph symbol ranges.

The preflight router for behavior-preserving change: before editing a symbol,
ask which tests cover it. COVERED symbols list their covering test contexts
(the fast regression oracle to run before/after the change); UNCOVERED symbols
require a pin-down characterization test or a sprout instead of an in-place edit.

Inputs: a coverage.py SQLite file (ideally recorded with dynamic_context =
test_function, e.g. `pytest --cov --cov-context=test`) or an istanbul/nyc
coverage-final.json (file/statement level, no per-test contexts).
"""

import argparse
import json
import os
import sqlite3
import sys


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--graph', required=True, help='code-graph.json from code_index.py')
    p.add_argument('--coverage', required=True,
                   help='.coverage SQLite file or istanbul coverage-final.json')
    p.add_argument('--files', nargs='+', default=None,
                   help='Limit verdicts to these root-relative files.')
    p.add_argument('--root', default=None,
                   help='Repo root for path mapping (default: graph meta.root).')
    return p.parse_args(argv)


def numbits_to_lines(blob):
    lines = set()
    for i, byte in enumerate(blob):
        for j in range(8):
            if byte & (1 << j):
                lines.add(i * 8 + j)
    lines.discard(0)
    return lines


def rel_to(root, abs_path):
    rel = os.path.relpath(abs_path, root)
    return rel.replace(os.sep, '/')


def read_sqlite(cov_path, root):
    """Return ({rel_path: [(context, lines)]}, contexts_available)."""
    con = sqlite3.connect(cov_path)
    rows = con.execute(
        'SELECT file.path, context.context, line_bits.numbits '
        'FROM line_bits '
        'JOIN file ON file.id = line_bits.file_id '
        'JOIN context ON context.id = line_bits.context_id'
    ).fetchall()
    con.close()
    by_file = {}
    contexts_available = False
    for abs_path, context, blob in rows:
        if context:
            contexts_available = True
        by_file.setdefault(rel_to(root, abs_path), []).append(
            (context, numbits_to_lines(blob))
        )
    return by_file, contexts_available


def read_istanbul(cov_path, root):
    """Return ({rel_path: [('', covered_lines)]}, contexts_available=False)."""
    with open(cov_path, encoding='utf-8') as fh:
        data = json.load(fh)
    by_file = {}
    for abs_path, entry in data.items():
        lines = set()
        for sid, count in entry.get('s', {}).items():
            if not count:
                continue
            stmt = entry['statementMap'][sid]
            lines.update(range(stmt['start']['line'], stmt['end']['line'] + 1))
        by_file[rel_to(root, abs_path)] = [('', lines)]
    return by_file, False


def symbol_rows(graph, files_filter):
    """Yield (symbol_id, rel_path, qualname, start, end) incl. class children."""
    node_id_by_path = {n['path']: n['id'] for n in graph['nodes']}
    for record in graph.get('files', []):
        rel = record['path']
        if files_filter and rel not in files_filter:
            continue
        nid = node_id_by_path.get(rel)
        if not nid:
            continue
        for sym in record.get('symbols', []):
            yield f"{nid}#{sym['name']}", rel, sym['start'], sym['end']
            for child in sym.get('children', []):
                qual = f"{sym['name']}.{child['name']}"
                yield f'{nid}#{qual}', rel, child['start'], child['end']


def verdict_for(start, end, file_cov, contexts_available):
    span = set(range(start, end + 1))
    tests = set()
    executed = False
    for context, lines in file_cov:
        if not (lines & span):
            continue
        executed = True
        if context:
            tests.add(context)
    if contexts_available:
        covered = bool(tests)
    else:
        covered = executed
    return ('COVERED' if covered else 'UNCOVERED'), sorted(tests)


def build_report(graph, coverage, contexts_available, files_filter):
    results = []
    for symbol, rel, start, end in symbol_rows(graph, files_filter):
        verdict, tests = verdict_for(
            start, end, coverage.get(rel, []), contexts_available
        )
        results.append({
            'symbol': symbol, 'path': rel, 'start': start, 'end': end,
            'verdict': verdict, 'tests': tests,
        })
    return {'contexts_available': contexts_available, 'results': results}


def load_coverage(cov_path, root):
    if not os.path.exists(cov_path):
        sys.stderr.write(
            f'No coverage data at {cov_path} — run the test suite first '
            '(pytest --cov --cov-context=test, or nyc --reporter=json).\n'
        )
        sys.exit(2)
    if cov_path.endswith('.json'):
        return read_istanbul(cov_path, root)
    return read_sqlite(cov_path, root)


def main(argv):
    args = parse_args(argv)
    with open(args.graph, encoding='utf-8') as fh:
        graph = json.load(fh)
    root = args.root or graph['meta']['root']
    coverage, contexts_available = load_coverage(args.coverage, root)
    files_filter = set(args.files) if args.files else None
    report = build_report(graph, coverage, contexts_available, files_filter)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write('\n')
    uncovered = sum(1 for r in report['results'] if r['verdict'] == 'UNCOVERED')
    sys.stderr.write(
        f"{len(report['results'])} symbols, {uncovered} UNCOVERED "
        f"(contexts_available={report['contexts_available']})\n"
    )
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
