#!/usr/bin/env python3
"""CI-gate structure validation for both governance shapes.

`context-governance: v1` keeps a standalone `ci-gates.md`; v2 folds it into
`implementation-plan.md`'s `## CI Gates` section. Checking only the v1 file meant
a v2-only change skipped CI-gate structure entirely while SKILL.md claimed it was
covered -- a documented guarantee with nothing behind it.

The two shapes get different term lists on purpose. v1's file had `## Required
Gates` / `## Promotion Policy` / `## Rollback Policy` headings; v2's section is
deliberately compact (a gate table plus merge-eligibility and rollback lines).
Demanding v1's vocabulary of a v2 section would re-inflate exactly what v2
compacted. Whether the section is AUTHORED at all rather than left as scaffold is
the gate's job -- `v2PlanSectionFinding` in src/commands/gate-artifacts.ts.
"""
from pathlib import Path
import argparse, re, sys

REQUIRED_TERMS_V1 = ['required gates', 'tier', 'trigger', 'workflow', 'promotion policy', 'rollback policy']
REQUIRED_TERMS_V2 = ['gate', 'trigger', 'required', 'merge eligibility', 'rollback']

SECTION_RE = re.compile(r'^##\s+CI Gates\s*$', re.IGNORECASE | re.MULTILINE)
NEXT_H2_RE = re.compile(r'^##\s+', re.MULTILINE)


def _check_text(label, text, terms):
    """Check one CI-gate surface. Returns list of error strings."""
    lowered = text.lower()
    missing = [t for t in terms if t not in lowered]
    if missing:
        return [f'{label}: ci-gates missing terms: ' + ', '.join(missing)]
    print(f'CI gates basic validation passed: {label}')
    return []


def check_file(p):
    return _check_text(str(p), p.read_text(encoding='utf-8', errors='ignore'), REQUIRED_TERMS_V1)


def _ci_gates_section(plan_path):
    """The `## CI Gates` section body of an implementation-plan.md, or None."""
    try:
        text = plan_path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return None
    m = SECTION_RE.search(text)
    if not m:
        return None
    rest = text[m.end():]
    nxt = NEXT_H2_RE.search(rest)
    return rest[:nxt.start()] if nxt else rest


def _governance(d):
    """'v2' | '' from tasks.yml, mirroring gate-artifacts.ts governanceVersion."""
    p = d / 'tasks.yml'
    if not p.exists():
        return ''
    try:
        for line in p.read_text(encoding='utf-8', errors='ignore').splitlines():
            if line.startswith('context-governance:'):
                return line.split(':', 1)[1].strip().strip('\'"')
    except OSError:
        return ''
    return ''


def check_change_dir(d):
    """Source chosen by GOVERNANCE, not file presence.

    `cdd-kit new --force` over a legacy directory does not delete its files, so a
    v2 change can still carry a stale ci-gates.md. Picking it by presence would
    either reject a valid folded plan because the leftover is incomplete, or pass
    an invalid folded section because the leftover happens to satisfy v1's terms.
    """
    v1 = d / 'ci-gates.md'
    if v1.exists() and _governance(d) != 'v2':
        return check_file(v1)
    section = _ci_gates_section(d / 'implementation-plan.md')
    if section is None and v1.exists():
        return check_file(v1)
    if section is None:
        return []  # neither shape present -- the gate's required-artifact check owns that
    return _check_text(f'{d.name}/implementation-plan.md ## CI Gates', section, REQUIRED_TERMS_V2)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('path', nargs='?', default=None)
    args = ap.parse_args()
    if args.path is not None:
        p = Path(args.path)
        if not p.exists():
            print(f'Warning: {p} not found -- skipping CI gates validation (file not yet created).')
            sys.exit(0)
        errors = check_file(p)
        if errors: [print(e) for e in errors]; sys.exit(1)
        sys.exit(0)

    changes_root = Path('specs/changes')
    if not changes_root.exists():
        print('Warning: specs/changes/ not found -- skipping CI gates validation.')
        sys.exit(0)
    dirs = sorted(p for p in changes_root.iterdir() if p.is_dir())
    if not dirs:
        print('Warning: specs/changes/ is empty -- skipping CI gates validation.')
        sys.exit(0)
    all_errors = []
    checked = False
    for d in dirs:
        if (d / 'ci-gates.md').exists() or _ci_gates_section(d / 'implementation-plan.md') is not None:
            checked = True
        all_errors.extend(check_change_dir(d))
    if not checked:
        print('Warning: no ci-gates.md and no `## CI Gates` section found in specs/changes/ -- skipping CI gates validation.')
        sys.exit(0)
    if all_errors:
        [print(e) for e in all_errors]; sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
