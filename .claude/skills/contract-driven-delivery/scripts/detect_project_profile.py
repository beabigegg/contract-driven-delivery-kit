#!/usr/bin/env python3
"""Detect a repository profile and print Markdown."""
from pathlib import Path
import argparse

FRONTEND_MARKERS = ['package.json', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'tailwind.config.js', 'tailwind.config.ts']
BACKEND_MARKERS = ['pyproject.toml', 'requirements.txt', 'app.py', 'main.py', 'manage.py', 'pom.xml', 'build.gradle']
CI_MARKERS = ['.github/workflows', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', '.circleci']
CONTRACT_DIRS = ['contracts', 'contract']

# The cdd-kit skill directory name — used to detect whether cdd-kit is installed.
CDD_KIT_SKILL = 'contract-driven-delivery'

def exists(root: Path, rel: str) -> bool:
    return (root / rel).exists()

def list_existing(root: Path, rels):
    return [r for r in rels if exists(root, r)]

def cdd_kit_installed(root: Path) -> bool:
    """Return True if cdd-kit's skill is present in this repo's .claude directory."""
    return (root / '.claude' / 'skills' / CDD_KIT_SKILL).exists()

def classify_agents(root: Path, kit_installed: bool):
    """
    Return (kit_agents, user_agents) lists of agent .md basenames.

    When cdd-kit is installed, ALL agents found under .claude/agents/ are
    assumed to originate from the kit installation (the kit ships its own
    agent suite and deploys it there). Users who add their own agents
    alongside the kit should note this in their AGENTS.md.
    If cdd-kit is NOT installed, all agents are treated as user-authored.
    """
    agents_dir = root / '.claude' / 'agents'
    if not agents_dir.is_dir():
        return [], []
    all_agents = sorted(p.name for p in agents_dir.glob('*.md'))
    if not all_agents:
        return [], []
    if kit_installed:
        return all_agents, []
    return [], all_agents

def classify_skills(root: Path, kit_installed: bool):
    """
    Return (kit_skills, user_skills) lists of skill directory names.

    contract-driven-delivery is always flagged as a cdd-kit skill when present.
    Other skills are user-authored.
    """
    skills_dir = root / '.claude' / 'skills'
    if not skills_dir.is_dir():
        return [], []
    all_skills = sorted(p.name for p in skills_dir.iterdir() if p.is_dir())
    kit_skills = [s for s in all_skills if s == CDD_KIT_SKILL]
    user_skills = [s for s in all_skills if s != CDD_KIT_SKILL]
    return kit_skills, user_skills

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

    kit_installed = cdd_kit_installed(root)
    kit_agents, user_agents = classify_agents(root, kit_installed)
    kit_skills, user_skills = classify_skills(root, kit_installed)

    lines = ['# Project Profile', '', '## Root', str(root), '', '## Detected Markers']
    lines += ['- frontend: ' + (', '.join(frontend) if frontend else 'none detected')]
    lines += ['- backend: ' + (', '.join(backend) if backend else 'none detected')]
    lines += ['- contracts: ' + (', '.join(contracts) if contracts else 'none detected')]
    lines += ['- tests: ' + (', '.join(tests) if tests else 'none detected')]
    lines += ['- ci/cd: ' + (', '.join(ci) if ci else 'none detected')]

    lines += ['', '## Claude Assets (.claude/)']
    if kit_installed:
        lines += [f'- cdd-kit detected (skill: {CDD_KIT_SKILL})']
    if kit_agents:
        lines += [f'- agents installed by cdd-kit ({len(kit_agents)}): ' + ', '.join(kit_agents)]
        lines += ['  (these are bundled by cdd-kit; not user-authored)']
    if user_agents:
        lines += [f'- user-authored agents ({len(user_agents)}): ' + ', '.join(user_agents)]
    if not kit_agents and not user_agents:
        lines += ['- agents: none detected']
    if kit_skills:
        lines += [f'- skills installed by cdd-kit ({len(kit_skills)}): ' + ', '.join(kit_skills)]
    if user_skills:
        lines += [f'- user-authored skills ({len(user_skills)}): ' + ', '.join(user_skills)]
    if not kit_skills and not user_skills:
        lines += ['- skills: none detected']

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
