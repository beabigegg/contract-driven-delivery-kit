#!/usr/bin/env python3
"""Basic ci-gates.md validation."""
from pathlib import Path
import argparse, sys
REQUIRED_TERMS=['required gates','tier','trigger','workflow','promotion policy','rollback policy']
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('path')
    args=ap.parse_args(); p=Path(args.path)
    if not p.exists(): print(f'{p} not found'); sys.exit(1)
    text=p.read_text(encoding='utf-8', errors='ignore').lower()
    missing=[t for t in REQUIRED_TERMS if t not in text]
    if missing: print('ci-gates missing terms: '+', '.join(missing)); sys.exit(1)
    print('CI gates basic validation passed.')
if __name__=='__main__': main()
