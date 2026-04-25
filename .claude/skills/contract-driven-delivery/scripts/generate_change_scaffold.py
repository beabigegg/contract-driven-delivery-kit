#!/usr/bin/env python3
"""Generate a specs/changes/<change-id> scaffold from bundled templates."""
from pathlib import Path
import argparse
import shutil

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('change_id')
    ap.add_argument('--root', default='.')
    ap.add_argument('--templates', default=None)
    args=ap.parse_args()
    root=Path(args.root).resolve()
    templates=Path(args.templates).resolve() if args.templates else Path(__file__).resolve().parents[1]/'templates'
    dest=root/'specs'/'changes'/args.change_id
    dest.mkdir(parents=True, exist_ok=False)
    mapping={
        'change-request.md':'change-request.md',
        'change-classification.md':'change-classification.md',
        'current-behavior.md':'current-behavior.md',
        'proposal.md':'proposal.md',
        'spec.md':'spec.md',
        'design.md':'design.md',
        'contracts.md':'contracts.md',
        'test-plan.md':'test-plan.md',
        'ci-gates.md':'ci-gates.md',
        'tasks.md':'tasks.md',
        'qa-report.md':'qa-report.md',
        'regression-report.md':'regression-report.md',
        'archive.md':'archive.md',
    }
    for src,dst in mapping.items():
        s=templates/src
        if s.exists():
            shutil.copyfile(s, dest/dst)
    print(f'created {dest}')
if __name__ == '__main__':
    main()
