#!/usr/bin/env python3
"""Check for required contract surfaces."""
from pathlib import Path
import argparse, sys
REQUIRED=['contracts/api/api-contract.md','contracts/css/css-contract.md','contracts/env/env-contract.md','contracts/data/data-shape-contract.md','contracts/business/business-rules.md','contracts/ci/ci-gate-contract.md']
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('root', nargs='?', default='.')
    args=ap.parse_args(); root=Path(args.root)
    missing=[p for p in REQUIRED if not (root/p).exists()]
    if missing:
        print('Missing contract files:'); [print(f'- {p}') for p in missing]; sys.exit(1)
    print('All required contract files are present.')
if __name__=='__main__': main()
