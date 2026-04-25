#!/usr/bin/env python3
"""Coarse traceability check for a change folder."""
from pathlib import Path
import argparse, sys
REQUIRED=['classification.md','test-plan.md','ci-gates.md','tasks.md']
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('change_dir')
    args=ap.parse_args(); d=Path(args.change_dir)
    if not d.exists(): print(f'{d} not found'); sys.exit(1)
    missing=[f for f in REQUIRED if not (d/f).exists()]
    if missing: print('Missing required change artifacts: '+', '.join(missing)); sys.exit(1)
    text='\n'.join((d/f).read_text(encoding='utf-8', errors='ignore') for f in REQUIRED)
    warnings=[]
    for term in ['contract','test','ci','gate']:
        if term not in text.lower(): warnings.append(term)
    if warnings: print('Warning: weak traceability terms: '+', '.join(warnings))
    print('Change traceability basic validation passed.')
if __name__=='__main__': main()
