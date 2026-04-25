# Install Guide

## 1. Copy common Claude Code assets

For cross-project reuse:

```bash
mkdir -p ~/.claude/agents ~/.claude/skills
cp -R .claude/agents/* ~/.claude/agents/
cp -R .claude/skills/contract-driven-delivery ~/.claude/skills/
```

For project-local reuse:

```bash
cp CLAUDE.template.md CLAUDE.md
cp -R .claude ./
```

## 2. Copy contract and spec templates

```bash
cp -R contracts ./contracts
cp -R specs ./specs
cp -R ci ./ci
```

If the repo already has these folders, merge file-by-file instead of overwriting.

## 3. First run in a repository

Ask Claude Code:

```text
Use the contract-driven-delivery workflow. Scan this repo, create a project profile, identify missing contracts, and recommend the minimum standardization changes before feature work.
```

## 4. Expected first-run output

`cdd-kit validate` will warn that contracts are placeholders. This is normal — the six contract files are scaffolded but empty. Validation exits 0; warnings are advisory until you fill the contracts.

See README.md → "What to expect after `cdd-kit init`" for the recommended filling order.

## 5. Required repository files

A mature repository should eventually contain:

```text
CLAUDE.md
contracts/api/api-contract.md
contracts/css/css-contract.md
contracts/env/env-contract.md
contracts/data/data-shape-contract.md
contracts/business/business-rules.md
contracts/ci/ci-gate-contract.md
specs/changes/
```

## 6. CI/CD setup

Start with the template in `ci/github-actions/contract-driven-gates.yml`. Adapt commands to the detected project profile. Keep fast gates required and long-running gates scheduled or manual until they pass a defined stability window.
