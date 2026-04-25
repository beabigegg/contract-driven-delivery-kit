#!/usr/bin/env python3
"""Basic env contract validation."""
from pathlib import Path
import argparse, sys
REQUIRED_COLUMNS=['name','scope','required','secret','default','example','validation']
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('path', nargs='?', default='contracts/env/env-contract.md')
    args=ap.parse_args(); p=Path(args.path)
    if not p.exists():
        print(f'Warning: {p} not found -- skipping env contract validation (file not yet created).')
        sys.exit(0)
    text=p.read_text(encoding='utf-8', errors='ignore').lower()
    missing=[c for c in REQUIRED_COLUMNS if c not in text]
    if missing: print('Env contract missing columns/terms: '+', '.join(missing)); sys.exit(1)
    if 'vite_' not in text and 'next_public_' not in text and 'public_' not in text:
        print('Warning: public frontend env policy not found.')
    print('Env contract basic validation passed.')
if __name__=='__main__': main()
