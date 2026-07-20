#!/usr/bin/env python3
"""Deprecated. `cdd-kit new <change-id>` is the only change scaffolder.

This script kept its own copy of the required/optional artifact lists, and that
copy went stale the moment `context-governance: v2` folded three artifacts away.
It emitted a `tasks.yml` marked v2 alongside the legacy v1
`change-classification.md` / `test-plan.md` / `ci-gates.md`, and omitted
`acceptance.yml` and `interaction-design.md` — which are separately gate-enforced,
so its output could not pass.

A second scaffolder means a second artifact list, and a second list drifts.
`src/commands/new-change.ts` is the single source; this file points at it rather
than racing it. Exits non-zero so a script calling it fails loudly instead of
continuing over a half-built change directory.
"""
import argparse
import sys


def main():
    ap = argparse.ArgumentParser(description='Deprecated — use `cdd-kit new`.')
    ap.add_argument('change_id', nargs='?')
    ap.add_argument('--root', default='.')
    ap.add_argument('--templates', default=None)
    ap.add_argument('--all', action='store_true')
    args = ap.parse_args()

    target = args.change_id or '<change-id>'
    suffix = ' --all' if args.all else ''
    print('This scaffolder is deprecated and deliberately writes nothing.')
    print()
    print(f'  Use:  cdd-kit new {target}{suffix}')
    print()
    print('It shipped a second copy of the artifact list, which drifted from the one')
    print('`cdd-kit new` uses: it emitted the legacy v1 files alongside a v2 tasks.yml')
    print('and omitted the separately-enforced acceptance.yml / interaction-design.md,')
    print('so the change it produced could not pass the gate. One scaffolder, one list.')
    sys.exit(1)


if __name__ == '__main__':
    main()
