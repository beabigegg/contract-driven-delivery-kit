#!/usr/bin/env python3
"""Coarse traceability check for a change folder."""
from pathlib import Path
import argparse, sys
from applicability import parse_frontmatter, _unquote, strip_inline_comment
# The required artifact set depends on the change's `context-governance` marker,
# exactly as src/commands/gate-artifacts.ts REQUIRED_FILES_V1/V2 does. Keeping
# only the v1 list here made this validator reject every v2 change -- and because
# `cdd-kit validate` runs it in CI, before the gate, a normal `cdd-kit new`
# change could not pass CI at all.
REQUIRED_V1=['change-classification.md','implementation-plan.md','test-plan.md','ci-gates.md','tasks.yml']
REQUIRED_V2=['change-request.md','implementation-plan.md','tasks.yml']

def _tasks_field(fm, key):
    """Extract and unquote a top-level tasks.yml scalar field already parsed
    by applicability.parse_frontmatter. Reuses applicability._unquote for the
    double-quoted/plain cases; additionally undoes YAML's single-quoted `''`
    escape (js-yaml's default emission style for a value containing a literal
    apostrophe or colon -- e.g. `abandon.ts`'s --reason text), which _unquote
    does not handle since it was built for simpler hand-written markdown
    frontmatter. This is a minimal local supplement to the reused reader, not
    a competing third parser."""
    raw = fm.get(key, '')
    # Comment-strip FIRST: the single-quoted branch below returns early and
    # would otherwise never reach _unquote's stripping, so `status: 'abandoned'
    # # note` kept the trailing comment inside the value.
    v = strip_inline_comment(raw)
    if len(v) >= 2 and v[0] == v[-1] == "'":
        return v[1:-1].replace("''", "'")
    return _unquote(v)

def _read_abandoned_marker(d):
    """Read tasks.yml's top-level `status` + `abandoned-reason` fields, if any.

    tasks.yml is plain YAML with no `---` frontmatter fences (unlike the
    contract .md files applicability.py's `parse_frontmatter` was built for),
    so its raw text is wrapped in synthetic fences before reuse of that
    function -- this reuses the exact field-matching regex instead of writing
    a third frontmatter parser (ADR 0011's discipline, applied to a second
    marker). Nested/indented YAML (the `tasks:` list rows `abandon.ts` writes)
    never matches the flush-left field regex, so only top-level scalar keys
    are read. Returns (status, reason) as unquoted strings ('' when
    absent/missing/unreadable)."""
    tasks_path = d / 'tasks.yml'
    if not tasks_path.exists():
        return ('', '')
    try:
        text = tasks_path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return ('', '')
    fm = parse_frontmatter('---\n' + text + '\n---\n')
    return (_tasks_field(fm, 'status'), _tasks_field(fm, 'abandoned-reason'))

def _read_governance(d):
    """`v2` | `v1` | '' (legacy/unreadable) from tasks.yml, mirroring
    gate-artifacts.ts governanceVersion. An unreadable file yields '' and so
    falls back to the v1 list -- the stricter of the two, never the looser."""
    tasks_path = d / 'tasks.yml'
    if not tasks_path.exists():
        return ''
    try:
        text = tasks_path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return ''
    return _tasks_field(parse_frontmatter('---\n' + text + '\n---\n'), 'context-governance')

def check_change_dir(d):
    """Check one change directory. Returns list of error strings (empty = pass)."""
    errors=[]

    # ADR 0011 discipline extended to a second marker (mirrors applicability.py
    # exactly): tasks.yml `status: abandoned` + a non-empty `abandoned-reason`
    # SKIPS the required-artifact check below with an informational note; the
    # same status with a missing/empty reason is a HARD error (a bare skip
    # with no justification is never allowed); any other status, or no
    # tasks.yml at all, falls through unchanged to the required-artifact check
    # -- an unmarked incomplete directory still HARD-FAILS.
    status, reason = _read_abandoned_marker(d)
    if status == 'abandoned':
        if not reason:
            errors.append(
                f'{d.name}: tasks.yml status: abandoned requires a non-empty '
                f'abandoned-reason (ADR 0011 discipline) — a bare skip with no '
                f'justification is never allowed.'
            )
            return errors
        print(f'Info: {d.name} marked tasks.yml status: abandoned ({reason}) — required-artifact check skipped.')
        return errors

    governance=_read_governance(d)
    required = REQUIRED_V2 if governance == 'v2' else REQUIRED_V1
    missing=[f for f in required if not (d/f).exists()]
    if missing:
        errors.append(f'{d.name}: missing required artifacts: '+', '.join(missing))
        return errors
    text='\n'.join((d/f).read_text(encoding='utf-8', errors='ignore') for f in required)
    warnings=[]
    for term in ['contract','test','ci','gate']:
        if term not in text.lower(): warnings.append(term)
    if warnings: print(f'Warning: {d.name}: weak traceability terms: '+', '.join(warnings))
    print(f'Change traceability basic validation passed: {d.name}')
    return errors
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('change_dir', nargs='?', default=None)
    args=ap.parse_args()
    if args.change_dir is not None:
        d=Path(args.change_dir)
        if not d.exists(): print(f'{d} not found'); sys.exit(1)
        errors=check_change_dir(d)
        if errors: [print(e) for e in errors]; sys.exit(1)
        sys.exit(0)
    # No argument: scan specs/changes/*/
    changes_root=Path('specs/changes')
    if not changes_root.exists() or not any(True for _ in changes_root.iterdir() if changes_root.exists()):
        print('Warning: specs/changes/ not found or empty -- skipping spec traceability validation.')
        sys.exit(0)
    subdirs=[p for p in changes_root.iterdir() if p.is_dir()]
    if not subdirs:
        print('Warning: specs/changes/ is empty -- skipping spec traceability validation.')
        sys.exit(0)
    all_errors=[]
    for d in sorted(subdirs):
        all_errors.extend(check_change_dir(d))
    if all_errors:
        [print(e) for e in all_errors]; sys.exit(1)
    sys.exit(0)
if __name__=='__main__': main()
