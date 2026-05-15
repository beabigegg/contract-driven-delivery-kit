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
    ap.add_argument('--all', action='store_true', help='also copy optional report/spec templates')
    args=ap.parse_args()
    root=Path(args.root).resolve()
    templates=Path(args.templates).resolve() if args.templates else Path(__file__).resolve().parents[1]/'templates'
    dest=root/'specs'/'changes'/args.change_id
    dest.mkdir(parents=True, exist_ok=False)
    required={
        'change-request.md':'change-request.md',
        'change-classification.md':'change-classification.md',
        'implementation-plan.md':'implementation-plan.md',
        'test-plan.md':'test-plan.md',
        'ci-gates.md':'ci-gates.md',
        'tasks.yml':'tasks.yml',
    }
    optional={
        'current-behavior.md':'current-behavior.md',
        'proposal.md':'proposal.md',
        'spec.md':'spec.md',
        'design.md':'design.md',
        'contracts.md':'contracts.md',
        'qa-report.md':'qa-report.md',
        'regression-report.md':'regression-report.md',
        'visual-review-report.md':'visual-review-report.md',
        'monkey-test-report.md':'monkey-test-report.md',
        'stress-soak-report.md':'stress-soak-report.md',
        'archive.md':'archive.md',
    }
    mapping=dict(required)
    if args.all:
        mapping.update(optional)
    for src,dst in mapping.items():
        s=templates/src
        if s.exists():
            shutil.copyfile(s, dest/dst)
    print(f'created {dest}')
if __name__ == '__main__':
    main()
