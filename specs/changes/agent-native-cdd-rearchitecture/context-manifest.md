---
change-id: agent-native-cdd-rearchitecture
context-governance: v1
last-changed: 2026-07-11
---

# Context Manifest: agent-native-cdd-rearchitecture

## Affected Surfaces

- CDD architecture and ownership boundaries
- Agent doctrine and capability composition
- Skill and runtime responsibilities
- API/data-shape Boundary Guard
- Project guidance and provider adapters
- Compatibility profiles and consumer migration

## Allowed Paths

- docs/adr/
- docs/rfc/
- docs/migration/
- .claude/agents/
- .claude/skills/
- CLAUDE.md
- CLAUDE.template.md
- AGENTS.template.md
- specs/templates/
- specs/changes/agent-native-cdd-rearchitecture/
- src/cli/
- src/commands/
- src/mcp/
- src/code-map/
- src/code-graph/
- src/contracts/
- hooks/
- package.json
- README.md

## Approved Expansions

None.

## Context Expansion Requests

None.

## Agent Work Packets

### spec-architect

- docs/adr/
- docs/rfc/
- docs/migration/
- .claude/agents/
- .claude/skills/
- CLAUDE.template.md
- specs/changes/agent-native-cdd-rearchitecture/

### contract-reviewer

- docs/adr/
- docs/rfc/
- docs/migration/
- src/contracts/
- specs/changes/agent-native-cdd-rearchitecture/

### qa-reviewer

- docs/adr/
- docs/rfc/
- docs/migration/
- specs/changes/agent-native-cdd-rearchitecture/
- package.json

## Forbidden by Default

- specs/archive/
- sibling specs/changes/
- assets/
- node_modules/
- dist/
- build/
- .git/
- .claude/worktrees/

Historical archives are intentionally excluded from planning. Existing public
ADRs, current agents, templates and project guidance provide the relevant
current-state evidence for this RFC.
