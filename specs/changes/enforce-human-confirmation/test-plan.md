---
change-id: enforce-human-confirmation
schema-version: 0.1.0
last-changed: 2026-07-10
risk: high
tier: 1
---

# Test Plan: enforce-human-confirmation

Every test below names its MUTATION and the discriminator it asserts. A green
test is worthless until the named one-line mutation turns it red. For CLI `gate`
tests the discriminator is the STREAM (`log.warn`→stdout, `log.error`→stderr;
`logger.ts:8-22`), never the exit code — a scaffolded governed change already
exits non-zero on unrelated checks. For the standalone `*.sh` hook tests the exit
code (2 vs 0) + stderr text IS the discriminator: `spawnSync` runs the script
alone, with no other checks to muddy the signal.

## Acceptance Criteria → Test Mapping
| criterion id | test family | test file path | tier |
|---|---|---|---|
| AC-1 | integration | test/cli/gate-design.test.ts | 1 |
| AC-2 | integration | test/cli/gate-design.test.ts | 1 |
| AC-3 | integration | test/cli/design-write-hook.test.ts | 1 |
| AC-3 | integration | test/cli/acceptance-write-hook.test.ts | 1 |
| AC-4 | integration | test/cli/gate.test.ts | 1 |
| AC-4 | integration | test/cli/design-confirm.test.ts | 1 |
| AC-4 | unit | test/utils/design-hash.test.ts | 0 |
| AC-5 | e2e | test/acceptance/interaction-design-loop.driver.test.ts | 1 |
| AC-6 | e2e | test/acceptance/interaction-design-loop.driver.test.ts | 3 |
| AC-7 | integration | test/cli/gate-design.test.ts | 1 |
| AC-7 | integration | test/cli/gate.test.ts | 1 |
| AC-8 | contract | test/contracts/ci-workflow.test.ts | 0 |
| AC-8 | contract | test/contracts/interaction-design-template.test.ts | 0 |
| sixth citation form (enables AC-6; described under AC-8) | unit | test/utils/design-provenance.test.ts | 0 |

## Test Families Required
Mark all that apply: **unit / contract / integration / e2e** — (data-boundary, resilience, monkey, stress, soak: none; no data/UI/load surface).

## Mutation Matrix (load-bearing)
| id | file | discriminator asserted | mutation that MUST turn it red |
|---|---|---|---|
| T1a empty Presented Info | gate-design.test.ts | stderr has `## Presented Information` + `zero rows`; stdout has neither | delete the info-row-count check in gate-design.ts |
| T1b empty States | gate-design.test.ts | stderr has `## States` + `zero rows` | delete the states-row-count check |
| T1c both tables populated | gate-design.test.ts | no `zero rows` msg on any stream | guards T1a/b against false-positive |
| T1d not-applicable + empty tables | gate-design.test.ts | no `zero rows` error | move row-count check ABOVE the not-applicable return |
| T1e legacy vs --strict | gate-design.test.ts | non-strict: `zero rows` on stdout; `--strict`: on stderr | drop `isNewChange \|\| strict` guard → non-strict lands on stderr |
| T3a design lock write blocked | design-write-hook.test.ts | exit 2 + stderr, with AND without `CDD_DESIGN_WRITE_STRICT` set | make `.cdd/design-lock.json` case fall through to exit 0 |
| T3b design body write allowed | design-write-hook.test.ts | exit 0 for interaction-design.md, env set OR unset | re-add a toggle branch that blocks the body |
| T3c acceptance lock write blocked | acceptance-write-hook.test.ts | exit 2 + stderr regardless of env | as T3a for acceptance-lock.json |
| T3d acceptance body write allowed | acceptance-write-hook.test.ts | exit 0 regardless of env | re-add toggle blocking acceptance.yml |
| T4a no settings, CI='' , non-strict | gate.test.ts | `settings.json not found` on stdout only | make the not-found branch always `log.error` |
| T4b no settings, CI='true' | gate.test.ts | `settings.json not found` on stderr | make the CI branch `log.warn` |
| T4c no settings, --strict, CI='' | gate.test.ts | not-found on stderr | drop `--strict` from the hard-fail condition |
| T4d settings w/o design hook, CI='true' | gate.test.ts | `exists but does not register the design-write hook` on stderr; text ≠ T4b text | collapse the two absence messages into one string |
| T4e settings with both tracked hooks | gate.test.ts | no hook-install finding; AND pointing entry at `.claude/hooks/…` (untracked) must fail | accept an untracked-path command as satisfying the check |
| T4f legacy dir, CI='true', no hook | gate.test.ts | error on stderr even for a legacy/non-governed change | gate the check on `isNewChange` → legacy only warns |
| T4g confirm records provenance | design-confirm.test.ts | parsed lock entry has `git-author`, `tty`, `timestamp` | stop writing the three fields in writeDesignLock |
| T4h no authenticity claim | gate.test.ts | gate output never matches /human-made\|human-verified\|authentic/i | add wording asserting the baseline is human-made |
| T6a unique substring | design-provenance.test.ts | `ci-gate: <heading> :: <unique text>` → ok:true | (guards T6b/c) |
| T6b ≥2 occurrences | design-provenance.test.ts | ok:false + `ambiguous` | change occurrence check `=== 1` → `>= 1` |
| T6c 0 occurrences | design-provenance.test.ts | ok:false + `not found` | change `=== 1` → `<= 1` |
| T6d bare name w/ trailing parenthetical | design-provenance.test.ts | `Provenance Reconciliation Policy` resolves to `## …(ADR 0012 §2)` | drop parenthetical-tolerant heading lookup |
| T6e level-aware terminator | design-provenance.test.ts | a substring only in a sibling `###` below the cited `###` → ok:false | revert sectionBody terminator to `(?=\n## \|$)` |
| T6f line-anchored opening | design-provenance.test.ts | citing `## X` does not match inside `### X` | remove the full-line anchor in sectionBody |
| T6g normalization + case | design-provenance.test.ts | `no recorded baseline at all also fails` matches `**no** …`; wrong-case rejected | remove `*_\`` strip (a); make compare case-insensitive (b) |
| T6h real-contract anchors | design-provenance.test.ts | run vs real ci-gate-contract.md: 16 anchors resolve; `:: the`, `:: AC-4`, `:: AC-7` rejected ambiguous | any resolver mutation above |

## Test Execution Ladder
| phase | required | command source | max failures | result artifact |
|---|---:|---|---:|---|
| collect | yes | cdd-kit test select | 1 | test-runs/<run-id>/summary.json |
| targeted | yes | cdd-kit test select | 1 | test-evidence.yml |
| changed-area | yes | cdd-kit test select | 1 | test-evidence.yml |
| contract | if affected | cdd-kit validate | 1 | test-evidence.yml |
| quality | if configured | ci-gates.md | 1 | test-evidence.yml |
| full | final/CI | cdd-kit test run --phase full | 1 | test-evidence.yml |

## Test Update Contract
| existing test | action | reason |
|---|---|---|
| test/cli/design-write-hook.test.ts::advisory nudges…ALLOWS (exit 0) | delete | body-write is now always allowed via the path-keyed axis; advisory/strict toggle retired (AC-3) |
| test/cli/design-write-hook.test.ts::strict BLOCKS the edit (exit 2)…CDD_DESIGN_WRITE_STRICT=0 | delete | the `CDD_DESIGN_WRITE_STRICT` toggle no longer exists (AC-3) |
| test/cli/acceptance-write-hook.test.ts (toggle-based body-block cases) | delete | `CDD_ACCEPTANCE_WRITE_STRICT` retired; body always allowed (AC-3) |
| test/cli/gate-design.test.ts::buildDesign default fixture | update | defaults `infoRows`/`stateRows` to `[]`; AC-1 now fires on the "fully valid" fixture (line ~462) unless the helper seeds ≥1 info row and ≥1 state row |

## Stop Rules
- Do not run broad pytest/vitest before targeted and changed-area phases pass.
- Do not investigate more than the first failure per phase.
- Do not classify any failure as known, pre-existing, waived, or allowed.
- If full suite fails, record the first failure and block the gate.

## Out of Scope
- Preventing a `Bash`-holder from self-stamping (DAC-1; unavailable on this machine). No T3*/T4* test may be worded as "Bash blocked".
- Unclosed-HTML-comment leak in `stripHtmlComments` (change-request §6): the post-fcf1937 missing-baseline error already catches it.
- Over-fetch / reverse-direction provenance advisory (corpus-wide `doctor`, never a per-change gate).

## Notes
- **Untestable-by-design (findings):** AC-4 self-stamp prevention has no positive test (mechanism deliberately absent). AC-5 cannot mechanically prove a human, not an agent, chose the fork — only its consequences (resolved Open Decisions + locked baseline). AC-6's real dogfood lock is a human-run artifact I may not produce; qa-reviewer verifies it.
- **CI-env trap:** `runCli` spreads `process.env` (includes `CI=true` on the runner). Warn-path tests (T4a) MUST pass `env:{CI:''}`; error-path tests (T4b/T4c/T4f) MUST pass `env:{CI:'true'}` — otherwise they silently test the opposite branch depending on where they run.
- **Contract finding:** ci-gate-contract.md:383 says `:: the` occurs 18×; interaction-design.md `## Provenance` says 23×. Both ≥2 so T6h rejects either way, but contract-reviewer should reconcile.
- **sectionBody drift** has no allowed dedicated test; T6e/T6f prove the two fixes via the resolver, and existing `## Confirmed` hash tests guard the "zero drift" claim (drift would break design-confirm.test.ts + gate-design tamper/reflow tests). A direct test/utils/markdown-section.test.ts would be stronger — request via CER if wanted.
- **Question for the human (acceptance.yml — I may not write it):** should the oracle pin (a) the not-found vs not-registered message pair stays distinct, and (b) gate output never claims a baseline is human-made? Both are business-language guarantees only you may author.
