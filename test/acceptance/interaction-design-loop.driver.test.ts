/**
 * Acceptance driver for specs/changes/interaction-design-loop/acceptance.yml
 * (ADR 0012 / ADR 0010). This file lives under test/acceptance/, the
 * conventional driver directory the enforceAcceptanceOracle AC-4 scan
 * discovers, so it is itself subject to the mock-of-SUT and hardcoded-expect
 * checks it exercises.
 *
 * SUT = the REAL enforceInteractionDesign check reached through the REAL
 * cdd-kit gate <change-id> (dist/cli/index.js via runCli), against a
 * hermetic temp repo -- never vi.mock/vi.spyOn/patch of any kind. Every
 * case input/expect is read from the emitted loader
 * (specs/templates/acceptance-driver/acceptance.loader.ts) -- never
 * hardcoded here.
 *
 * A note on the "never hardcode expect" rule (src/utils/mock-of-sut-scan.ts):
 * this oracle own leaf values include the gate outcome word itself (past
 * tense), a single open-decision id, a full re-confirm sentence, and two
 * state ids -- none of which are on the scanner generic-stopword exempt
 * list. So this file never types any of those literals; every assertion
 * either (a) reads the value at runtime from loadCase(...) and compares the
 * REAL CLI output against that runtime value, or (b) derives the outcome
 * structurally from the real exit code, exactly like the
 * not-applicable-contracts driver own documented workaround. Throughout
 * this file and its comments, prefer the present-tense verb ("the gate
 * blocks/halts/rejects") over the past-tense noun form so no leaf literal
 * is ever typed as a string constant.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import { runCli, makeTempDir, cleanupDir, hasPython, posixShell, posixShellEnv } from "../helpers.js";
import { loadAllCases, loadCase } from "../../specs/templates/acceptance-driver/acceptance.loader.js";

const CHANGE_ID = "interaction-design-loop";

interface OpenDecisionInput {
  id: string;
  question: string;
  answered: boolean;
}

interface StateInput {
  id: string;
  meaning: string;
  discriminator: string;
}

interface InfoInput {
  item: string;
  rationale?: string;
  provenance: string;
}

interface DesignOpts {
  openDecisionLines?: string[];
  confirmedText?: string | null;
  infoRows?: InfoInput[];
  stateRows?: StateInput[];
}

/** A minimal, well-formed api-contract.md exposing one resolvable endpoint, so
 * a seeded Presented Information / States citation reconciles (ADR 0012 §2).
 * Used by cases that must be OTHERWISE fully valid — since AC-1, an empty
 * derivation chain is itself a blocking condition, so "only the option under
 * test affects the result" now requires ≥1 real info row and ≥1 real state. */
function writeApiContract(tmpRepo: string): void {
  mkdirSync(join(tmpRepo, "contracts", "api"), { recursive: true });
  writeFileSync(join(tmpRepo, "contracts", "api", "api-contract.md"), [
    "---",
    "contract: api",
    "schema-version: 0.1.0",
    "last-changed: 2026-07-09",
    "breaking-change-policy: deprecate-2-minors",
    "---",
    "",
    "# API Contract",
    "",
    "## API Style",
    "- response style: JSON REST",
    "",
    "## Endpoint Requirements",
    "| method | path | auth | request schema | response schema | errors | tests |",
    "|--------|------|------|----------------|-----------------|--------|-------|",
    "| GET | /api/v1/orders | required | - | - | 401,403 | x |",
    "",
    "## Schemas",
    "",
    "## Error Format",
    "Standard envelope.",
    "",
    "## Compatibility Policy",
    "No breaking changes.",
    "",
    "## Endpoint Inventory Policy",
    "All endpoints listed.",
    "",
    "## Breaking Change Policy",
    "RFC required.",
    "",
  ].join("\n"), "utf8");
}

function scaffold(tmpRepo: string, changeId: string): string {
  const changeDir = join(tmpRepo, "specs", "changes", changeId);
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, "tasks.yml"), [
    "change-id: " + changeId,
    "status: in-progress",
    "context-governance: v1",
    "tasks: []",
    "",
  ].join("\n"), "utf8");
  return changeDir;
}

/** Build a syntactically-complete interaction-design.md; every section the
 * gate parser looks for is present (some deliberately empty) so only the
 * option under test can affect the result -- mirrors the fixture-building
 * convention of test/cli/gate-design.test.ts own buildDesign helper. */
function buildDesign(opts: DesignOpts): string {
  const openDecisionLines = opts.openDecisionLines ?? [
    "- [x] a resolved placeholder decision so this section is never the condition under test",
  ];
  const infoRows = opts.infoRows ?? [];
  const stateRows = opts.stateRows ?? [];

  const lines: string[] = [];
  lines.push("# Interaction Design: acceptance-driver fixture");
  lines.push("");
  lines.push(
    "This interaction design describes a screen: what it shows, why each control exists, and how " +
    "each state is told apart from every other state -- enough prose to clear the stub-detection " +
    "floor the gate applies before it looks at any individual section.",
  );
  lines.push("");
  lines.push("## Presented Information");
  lines.push("| item | rationale | provenance |");
  lines.push("|---|---|---|");
  for (const i of infoRows) lines.push("| " + i.item + " | " + (i.rationale ?? "answers a user question") + " | " + i.provenance + " |");
  lines.push("");
  lines.push("## User Intents");
  lines.push("| id | intent | frequency | path |");
  lines.push("|---|---|---|---|");
  lines.push("");
  lines.push("## Controls");
  lines.push("| id | control | intent |");
  lines.push("|---|---|---|");
  lines.push("");
  lines.push("## Reversibility");
  lines.push("The user can always tell where they are and return to the previous state.");
  lines.push("");
  lines.push("## States");
  lines.push("| id | meaning | discriminator |");
  lines.push("|---|---|---|");
  for (const s of stateRows) lines.push("| " + s.id + " | " + s.meaning + " | " + s.discriminator + " |");
  lines.push("");
  lines.push("## Open Decisions");
  for (const l of openDecisionLines) lines.push(l);
  lines.push("");
  lines.push("## Confirmed");
  if (opts.confirmedText) lines.push(opts.confirmedText);
  lines.push("");
  return lines.join("\n");
}

function writeDesign(changeDir: string, opts: DesignOpts): void {
  writeFileSync(join(changeDir, "interaction-design.md"), buildDesign(opts), "utf8");
}

let tmpRepo: string;
let tmpHome: string;

beforeEach(() => {
  tmpRepo = makeTempDir("cdd-idl-acceptance-repo-");
  tmpHome = makeTempDir("cdd-idl-acceptance-home-");
  const r = runCli(["init", "--local-only"], { cwd: tmpRepo, home: tmpHome });
  if (r.status !== 0) throw new Error("Setup init failed: " + r.stderr);
});

afterEach(() => {
  cleanupDir(tmpRepo);
  cleanupDir(tmpHome);
});

describe.skipIf(!hasPython())("interaction-design-loop acceptance driver (specs/changes/interaction-design-loop/acceptance.yml)", () => {
  it("loader exposes the 3 real cases the maintainer authored", () => {
    const cases = loadAllCases(CHANGE_ID);
    expect(Object.keys(cases).sort()).toEqual([
      "tampered-after-confirmation-blocks",
      "two-states-sharing-one-discriminator-blocks",
      "unanswered-open-decision-blocks",
    ]);
  });

  it("unanswered-open-decision-blocks", () => {
    const loaded = loadCase(CHANGE_ID, "unanswered-open-decision-blocks");
    const input = loaded.input as {
      "interaction-design": { "open-decisions": OpenDecisionInput[] };
    };
    const expected = loaded.expect as { "error-cites": string };
    const decisions = input["interaction-design"]["open-decisions"];

    const changeId = "idl-open-decision";
    const changeDir = scaffold(tmpRepo, changeId);
    writeDesign(changeDir, {
      openDecisionLines: decisions.map(
        (d) => "- [" + (d.answered ? "x" : " ") + "] " + d.id + ": " + d.question,
      ),
      confirmedText: null,
    });

    const r = runCli(["gate", changeId], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;

    expect(r.status).not.toBe(0);
    expect(out).toContain(expected["error-cites"]);
  });

  it("tampered-after-confirmation-blocks", () => {
    const expected = loadCase(CHANGE_ID, "tampered-after-confirmation-blocks").expect as {
      "error-message": string;
    };

    const changeId = "idl-tamper";
    const changeDir = scaffold(tmpRepo, changeId);
    writeDesign(changeDir, { confirmedText: "Initial human answer: keep the current behavior as-is." });

    const confirm = runCli(["design", "confirm", changeId], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    writeDesign(changeDir, { confirmedText: "Revised human answer: change the current behavior instead." });

    const r = runCli(["gate", changeId], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;

    expect(r.status).not.toBe(0);
    expect(out).toContain(expected["error-message"]);
  });

  it("two-states-sharing-one-discriminator-blocks", () => {
    const loaded = loadCase(CHANGE_ID, "two-states-sharing-one-discriminator-blocks");
    const input = loaded.input as { "interaction-design": { states: StateInput[] } };
    const expected = loaded.expect as { "error-cites": string[] };
    const states = input["interaction-design"].states;

    const changeId = "idl-shared-discriminator";
    const changeDir = scaffold(tmpRepo, changeId);
    writeDesign(changeDir, {
      stateRows: states,
      confirmedText: "Human answer: both states are correct as designed; the contract needs a distinct discriminator.",
    });

    const confirm = runCli(["design", "confirm", changeId], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    const r = runCli(["gate", changeId], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;

    expect(r.status).not.toBe(0);
    for (const citedId of expected["error-cites"]) {
      expect(out).toContain(citedId);
    }
  });

  // rules[] invariant bindings (ADR 0010 section 4: "rules each have at
  // least one bound invariant test"). No mechanical rule-to-test binding
  // scan exists in gate-acceptance.ts today (verified by reading it
  // directly for this driver); the naming convention below -- each test
  // title carries the rule own id verbatim -- is the same convention this
  // codebase already uses to tie a test to an AC id (e.g. "AC-4: ...").
  // Rule ids/statements are never scanned by scanAcceptanceDrivers (it only
  // walks cases[].expect), so writing them as literals here is safe and
  // intentional.

  it("rule aesthetics-never-blocks: colour, shape, shadow, motion, and emoji prose in an otherwise-valid confirmed design never gives the gate an opinion", () => {
    const changeId = "idl-rule-aesthetics";
    const changeDir = scaffold(tmpRepo, changeId);
    // Otherwise fully valid: a real derivation chain (≥1 info row, ≥1 state)
    // citing a resolvable endpoint, so the ONLY variable under test is the
    // aesthetic prose in ## Confirmed. Since AC-1, an empty chain would itself
    // block, which would mask what this rule test is asserting.
    writeApiContract(tmpRepo);
    writeDesign(changeDir, {
      infoRows: [{ item: "auth failure banner", provenance: "GET /api/v1/orders → 401" }],
      stateRows: [{ id: "state-ok", meaning: "the request succeeded", discriminator: "GET /api/v1/orders → HTTP 200" }],
      confirmedText:
        "Human answer: yes -- and while we are at it, the buttons should use a soft blue colour, " +
        "rounded corners, a subtle drop shadow, and a gentle hover animation, with a little celebration " +
        "emoji \u{1F389} on success. None of that is something this gate should have any opinion about.",
    });

    const confirm = runCli(["design", "confirm", changeId], { cwd: tmpRepo, home: tmpHome });
    expect(confirm.status, confirm.stdout + confirm.stderr).toBe(0);

    const r = runCli(["gate", changeId], { cwd: tmpRepo, home: tmpHome });
    const out = r.stdout + r.stderr;
    expect(out).not.toMatch(/interaction-design\.md/i);
  });

  it("rule human-answer-never-invented: interaction-designer is structurally read-only", () => {
    const agentPath = join(".claude", "agents", "interaction-designer.md");
    const content = readFileSync(agentPath, "utf8");
    const toolsLine = content.match(/^tools:\s*(.+)$/m);
    expect(toolsLine).not.toBeNull();
    const tools = (toolsLine as RegExpMatchArray)[1].split(",").map((t) => t.trim()).sort();
    expect(tools).toEqual(["Glob", "Grep", "Read"]);
  });

  it(
    "rule human-answer-never-invented: pre-tool-use-design-write.sh blocks an agent write to the lock sidecar",
    () => {
      const hookPath = join(process.cwd(), "hooks", "pre-tool-use-design-write.sh");
      const payload = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: ".cdd/design-lock.json" } });
      const hookRun = spawnSync(posixShell(), [hookPath], {
        cwd: tmpRepo,
        input: payload,
        env: posixShellEnv({ ...process.env, CDD_DESIGN_WRITE_STRICT: "1" }),
        encoding: "utf8",
      });
      expect(hookRun.status).toBe(2);
      expect(hookRun.stderr).toMatch(/human/i);
    },
  );
});
