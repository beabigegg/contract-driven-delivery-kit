#!/usr/bin/env python3
"""Coarse traceability check for a change folder."""
from pathlib import Path
import argparse, sys
REQUIRED=['change-classification.md','test-plan.md','ci-gates.md','tasks.yml']
def check_change_dir(d):
    """Check one change directory. Returns list of error strings (empty = pass)."""
    errors=[]
    missing=[f for f in REQUIRED if not (d/f).exists()]
    if missing:
        errors.append(f'{d.name}: missing required artifacts: '+', '.join(missing))
        return errors
    text='\n'.join((d/f).read_text(encoding='utf-8', errors='ignore') for f in REQUIRED)
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
