# implementation-plan

Use this prompt template with the Contract-Driven Delivery workflow.

## Input
- User request:
- Repository context:
- Existing artifacts:
- Constraints:

## Task
Produce `specs/changes/<change-id>/implementation-plan.md` for implementation agents. Do not implement code.

The plan should be an execution packet, not a history essay. It should convert the senior-agent investigation, design, contracts, and test strategy into precise actions that backend/frontend/test agents can follow without reading the full user discussion.

## Required Output
- Objective
- In scope / out of scope
- Required changes
- File-level plan
- Contract updates
- Test execution plan
- Acceptance criteria mapping
- Handoff constraints
- Known risks
