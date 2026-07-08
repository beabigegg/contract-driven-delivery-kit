# Skill & Agent Authoring Standard

Adapted from the superpowers writing-skills method (github.com/obra/superpowers).
Applies when adding or editing a cdd-kit skill (`.claude/skills/*/SKILL.md`),
agent (`.claude/agents/*.md`), or reference standard (`references/*.md`).

## Core principle: TDD for process docs

**No skill without a failing test first.** Before writing guidance, observe an
agent fail *without* it and capture the exact rationalization it used. The skill
exists to counter that specific failure — not to restate what a capable agent
already does. Guidance nobody was going to get wrong is noise.

- **RED** — run the pressure scenario with no skill; record the baseline
  behavior and the precise wrong reasoning.
- **GREEN** — write the minimal guidance that closes that gap; confirm the agent
  now complies.
- **REFACTOR** — find the *new* rationalization the fix exposes, add an explicit
  counter, and re-test until it holds under pressure.

## Frontmatter

- `name`: letters, numbers, hyphens only.
- `description`: **triggering conditions only** — "use when …". Never summarize
  the workflow in the description. A description that lists steps causes agents
  to act on the summary instead of reading the full skill. Keep ≤ 1024 chars.

## Body

Lead with when-to-use and the core rule; put the mechanics next; end with common
mistakes. Favor cross-references over repetition — point at an existing
reference (`references/…`) or `--help` rather than re-listing flags. Keep
frequently-loaded skills tight; compress examples ruthlessly.

## cdd-kit-specific rules

- A new command needs a doc pointer **and** tests in `test/` (unit for pure
  logic, CLI-level for behavior), and must build (`node build.js`) and typecheck
  (`tsc --noEmit`) clean.
- A new reference must be pointed to from the SKILL.md workflow or an agent that
  uses it, or it is dead weight the agent never loads.
- Durable behavioral rules belong in `contracts/` or `CLAUDE.md`/`CODEX.md` via
  the `/cdd-close` promotion step — not scattered across agent prompts.
- Run `cdd-kit lint-agents` after editing agent frontmatter.

## Anti-patterns

- Session-specific narrative examples ("last time I …").
- Multiple language variants of the same example (dilutes quality).
- Generic labels with no semantic meaning (`step1`, `helper2`).
- Flowcharts for what is really a linear list.
