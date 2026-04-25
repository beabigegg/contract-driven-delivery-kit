#!/usr/bin/env python3
"""Detect a repository profile and print Markdown."""
from pathlib import Path
import argparse

FRONTEND_MARKERS = ['package.json', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'tailwind.config.js', 'tailwind.config.ts']
BACKEND_MARKERS = ['pyproject.toml', 'requirements.txt', 'app.py', 'main.py', 'manage.py', 'pom.xml', 'build.gradle']
CI_MARKERS = ['.github/workflows', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', '.circleci']
CONTRACT_DIRS = ['contracts', 'contract']

def exists(root: Path, rel: str) -> bool:
    return (root / rel).exists()

def list_existing(root: Path, rels):
    return [r for r in rels if exists(root, r)]

def detect_commands(root: Path):
    commands = {}
    pkg = root / 'package.json'
    if pkg.exists():
        text = pkg.read_text(encoding='utf-8', errors='ignore')
        for script in ['dev','build','test','lint','typecheck','e2e']:
            if f'"{script}"' in text:
                commands[script] = f'npm run {script}'
    if (root / 'pyproject.toml').exists() or (root / 'pytest.ini').exists() or (root / 'tests').exists():
        commands.setdefault('unit', 'pytest')
    return commands

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default='.')
    ap.add_argument('--write', help='optional output markdown path')
    args = ap.parse_args()
    root = Path(args.root).resolve()
    frontend = list_existing(root, FRONTEND_MARKERS)
    backend = list_existing(root, BACKEND_MARKERS)
    ci = list_existing(root, CI_MARKERS)
    contracts = [d for d in CONTRACT_DIRS if (root/d).exists()]
    tests = [p for p in ['tests','frontend/tests','e2e','playwright.config.ts','playwright.config.js'] if (root/p).exists()]
    commands = detect_commands(root)
    lines = ['# Project Profile', '', f'## Root', str(root), '', '## Detected Markers']
    lines += ['- frontend: ' + (', '.join(frontend) if frontend else 'none detected')]
    lines += ['- backend: ' + (', '.join(backend) if backend else 'none detected')]
    lines += ['- contracts: ' + (', '.join(contracts) if contracts else 'none detected')]
    lines += ['- tests: ' + (', '.join(tests) if tests else 'none detected')]
    lines += ['- ci/cd: ' + (', '.join(ci) if ci else 'none detected')]
    lines += ['', '## Suggested Commands']
    if commands:
        lines += [f'- {k}: `{v}`' for k,v in sorted(commands.items())]
    else:
        lines += ['- none detected; inspect README/CI manually']
    lines += ['', '## Missing Standard Surfaces']
    if not contracts: lines.append('- contracts directory not detected')
    if not ci: lines.append('- CI/CD workflow not detected')
    if not tests: lines.append('- tests not detected')
    out='\n'.join(lines)+'\n'
    if args.write:
        Path(args.write).write_text(out, encoding='utf-8')
    print(out)
if __name__ == '__main__':
    main()
