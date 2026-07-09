#!/usr/bin/env python3
"""Check for required contract surfaces."""
from pathlib import Path
import argparse, sys, re
from applicability import classify_file
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

def strip_frontmatter(text):
    """Remove YAML frontmatter delimited by --- ... ---. Used ONLY for the
    drift check below: the `applicability-reason` sentence lives in
    frontmatter and is often long prose, so measuring drift on the full raw
    text (as the unmarked-stub check does, unchanged, for AC-2) would count
    the reason itself toward "looks filled" and false-positive on every
    not-applicable contract with an honest reason. design.md's drift rule is
    about the contract BODY looking filled, so drift measures the body only."""
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            return text[end+4:].lstrip('\n')
    return text

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('root', nargs='?', default='.')
    args=ap.parse_args(); root=Path(args.root)
    missing=[p for p in REQUIRED if not (root/p).exists()]
    if missing:
        print('Missing contract files:'); [print(f'- {p}') for p in missing]; sys.exit(1)

    # ADR 0011: consult the shared applicability reader per contract family
    # before running the placeholder/stub check. `invalid` is always a hard
    # error (AC-3); `not-applicable` skips the stub check for that family and
    # prints an info note (AC-1) instead of silently passing OR failing; an
    # unmarked/`applicable` file is checked exactly as before (AC-2).
    invalid=[]
    skipped=[]
    drifted=[]
    placeholders=[]
    for p in REQUIRED:
        text=(root/p).read_text(encoding='utf-8', errors='ignore')
        result=classify_file(root/p)
        if result.status=='invalid':
            invalid.append(f'{p}: {result.error}')
            continue
        if result.status=='not-applicable':
            skipped.append((p, result.reason))
            if len(meaningful_chars(strip_frontmatter(text)))>=PLACEHOLDER_THRESHOLD:
                drifted.append(p)
            continue
        if len(meaningful_chars(text))<PLACEHOLDER_THRESHOLD:
            placeholders.append(p)

    if invalid:
        print('Error: invalid applicability marker:')
        [print(f'- {m}') for m in invalid]
        sys.exit(1)

    if placeholders:
        print('Error: contracts present but appear empty: '+', '.join(placeholders))
        print('Fill them in before relying on the gate.')
        sys.exit(1)

    for p, reason in skipped:
        print(f'Info: {p} marked applicability: not-applicable ({reason}) — presence/stub check skipped.')

    if drifted:
        print('Warning: the following contracts are marked applicability: not-applicable but their '
              'body now looks filled — the mark may be stale, reconsider it: '+', '.join(drifted))

    print('All required contract files are present.')
if __name__=='__main__': main()
