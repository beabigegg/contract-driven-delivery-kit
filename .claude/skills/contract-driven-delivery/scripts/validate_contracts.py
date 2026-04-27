#!/usr/bin/env python3
"""Check for required contract surfaces."""
from pathlib import Path
import argparse, sys, re
REQUIRED=['contracts/api/api-contract.md','contracts/css/css-contract.md','contracts/env/env-contract.md','contracts/data/data-shape-contract.md','contracts/business/business-rules.md','contracts/ci/ci-gate-contract.md']
PLACEHOLDER_THRESHOLD=470

def meaningful_chars(text):
    """Return text stripped of markdown headings, blank lines, table borders, and comments."""
    lines=text.splitlines()
    filtered=[]
    for line in lines:
        s=line.strip()
        if not s: continue
        if s.startswith('#'): continue
        if re.match(r'^[|\s\-:]+$', s): continue
        if s.startswith('<!--'): continue
        filtered.append(s)
    return ''.join(filtered)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('root', nargs='?', default='.')
    args=ap.parse_args(); root=Path(args.root)
    missing=[p for p in REQUIRED if not (root/p).exists()]
    if missing:
        print('Missing contract files:'); [print(f'- {p}') for p in missing]; sys.exit(1)
    placeholders=[]
    for p in REQUIRED:
        text=(root/p).read_text(encoding='utf-8', errors='ignore')
        if len(meaningful_chars(text))<PLACEHOLDER_THRESHOLD:
            placeholders.append(p)
    if placeholders:
        print('Error: contracts present but appear empty: '+', '.join(placeholders))
        print('Fill them in before relying on the gate.')
        sys.exit(1)
    print('All required contract files are present.')
if __name__=='__main__': main()
