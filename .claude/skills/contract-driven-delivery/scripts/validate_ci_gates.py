#!/usr/bin/env python3
"""Basic ci-gates.md validation."""
from pathlib import Path
import argparse, sys
REQUIRED_TERMS=['required gates','tier','trigger','workflow','promotion policy','rollback policy']
def check_file(p):
    """Check one ci-gates.md file. Returns list of error strings."""
    errors=[]
    text=p.read_text(encoding='utf-8', errors='ignore').lower()
    missing=[t for t in REQUIRED_TERMS if t not in text]
    if missing:
        errors.append(f'{p}: ci-gates missing terms: '+', '.join(missing))
    else:
        print(f'CI gates basic validation passed: {p}')
    return errors
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('path', nargs='?', default=None)
    args=ap.parse_args()
    if args.path is not None:
        p=Path(args.path)
        if not p.exists():
            print(f'Warning: {p} not found -- skipping CI gates validation (file not yet created).')
            sys.exit(0)
        errors=check_file(p)
        if errors: [print(e) for e in errors]; sys.exit(1)
        sys.exit(0)
    # No argument: scan specs/changes/*/ci-gates.md
    changes_root=Path('specs/changes')
    if not changes_root.exists():
        print('Warning: specs/changes/ not found -- skipping CI gates validation.')
        sys.exit(0)
    gates_files=sorted(changes_root.glob('*/ci-gates.md'))
    if not gates_files:
        print('Warning: no ci-gates.md found in specs/changes/ -- skipping CI gates validation.')
        sys.exit(0)
    all_errors=[]
    for p in gates_files:
        all_errors.extend(check_file(p))
    if all_errors:
        [print(e) for e in all_errors]; sys.exit(1)
    sys.exit(0)
if __name__=='__main__': main()
