import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  stripFrontmatter,
  parseEndpointTableRows,
  DEFAULT_CONTRACT_PATH,
} from '../contracts/parser.js';

/**
 * Substantive contract check (ADR 0004 §5). Beyond the structural validators, the
 * gate makes a mechanical, contract-substance assertion via the shared parser,
 * directly addressing the "gate passes placeholders / self-reported done"
 * weakness. It reads the repo's API contract (contracts are repo-global, like the
 * validators the gate runs) and no-ops on an empty/freshly-scaffolded table.
 *
 *   - Declared test coverage (warning; error under --strict): when the endpoint
 *     table has a `tests` column, no row may leave it blank — a row must not be
 *     silent about the coverage it claims. A table with no `tests` column is left
 *     alone (it is not tracking tests in the contract). --strict (release
 *     readiness) escalates the warning to a failure, mirroring how the gate
 *     already escalates pending tasks under --strict.
 *
 * Deliberately MINIMAL and CONSERVATIVE — a false positive here would break ADR
 * 0002's no-migration guarantee. In particular it does NOT flag unresolved
 * request/response schema references: `openapi export` resolves a cell only when
 * it matches a defined *typed* schema and otherwise preserves it as unresolved
 * Tier C prose WITHOUT error, so at read time a bare label (`UserList`, `object`,
 * a prose name) is indistinguishable from a real-but-missing reference. Flagging
 * those would force migration of valid Tier C rows the moment any schema is added,
 * and would mis-fire on every legacy prose label during incremental adoption.
 * Reference integrity is therefore enforced where intent is explicit — on the
 * WRITE side by `contract set`, which refuses to write an undefined reference —
 * and a read-side form keyed to the rows a change actually touches is left to a
 * later, diff-aware pass (ADR 0004 §5, "the rule set starts minimal and grows").
 */
export function enforceContractSubstance(cwd: string, errors: string[], warnings: string[], strict: boolean): void {
  const contractPath = join(cwd, DEFAULT_CONTRACT_PATH);
  if (!existsSync(contractPath)) return;

  let body: string;
  try {
    body = stripFrontmatter(readFileSync(contractPath, 'utf8')).body;
  } catch {
    return; // an unreadable contract is the structural validators' concern, not this one
  }

  const rows = parseEndpointTableRows(body);
  if (rows.length === 0) return; // empty / freshly-scaffolded table — nothing to assert
  const label = DEFAULT_CONTRACT_PATH;

  // Declared test coverage — only when the table actually has a `tests` column.
  for (const row of rows) {
    const tests = row.cells['tests'];
    if (tests === undefined || tests.trim() !== '') continue;
    const msg =
      `${label}: endpoint ${row.method.toUpperCase()} ${row.path} has an empty tests cell — ` +
      `name its contract test(s), or "-" if intentionally none.`;
    if (strict) errors.push(msg);
    else warnings.push(msg);
  }
}
