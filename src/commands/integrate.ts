/**
 * `cdd-kit integrate` — the fan-in coordinator for parallel changes (ADR 0009).
 *
 * Reads the reservation ledger, computes a contention matrix, and prints a
 * deterministic merge order. This is the piece that lets parallel worktree
 * development be integrated without hand-babysitting: it separates the merges a
 * script can safely sequence (distinct version lanes, disjoint surfaces) from
 * the genuine semantic overlaps a human must resolve (two changes editing the
 * same contract surface).
 *
 * Exit codes:
 *   0  safe — no surface collisions; follow the printed merge order
 *   3  unsafe — surface collisions found; a human must resolve the listed pairs
 *   1  no ledger / malformed ledger
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import { log } from '../utils/logger.js';
import { reservationsSchema } from '../schemas/reservations.schema.js';
import {
  RESERVATIONS_PATH,
  analyzeContention,
  type ReservationsFile,
} from './parallel-shared.js';

export interface IntegrateOptions {
  json?: boolean;
}

export async function integrate(opts: IntegrateOptions): Promise<void> {
  const repoRoot = process.cwd();
  const p = join(repoRoot, RESERVATIONS_PATH);

  if (!existsSync(p)) {
    log.error(`No reservation ledger at ${RESERVATIONS_PATH}. Run \`cdd-kit reserve\` before parallel work.`);
    process.exit(1);
  }

  const data = yaml.load(readFileSync(p, 'utf8'), { schema: yaml.JSON_SCHEMA });
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(reservationsSchema);
  if (!validate(data)) {
    log.error(`${RESERVATIONS_PATH} is malformed:`);
    for (const e of validate.errors ?? []) log.dim(`${e.instancePath} ${e.message}`);
    process.exit(1);
  }

  const ledger = data as ReservationsFile;
  const report = analyzeContention(ledger);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.safe ? 0 : 3);
  }

  log.blank();
  log.info(`Parallel integration plan — ${ledger.reservations.length} change(s)`);
  log.blank();

  if (report.versionCollisions.length) {
    log.warn('Version-lane collisions (re-run `cdd-kit reserve` to re-allocate):');
    for (const c of report.versionCollisions) {
      log.dim(`${c.changeIds[0]} ↔ ${c.changeIds[1]}: ${c.detail}`);
    }
    log.blank();
  }

  if (report.surfaceCollisions.length) {
    log.error('Surface collisions — a human must resolve these before parallel merge:');
    for (const c of report.surfaceCollisions) {
      log.dim(`${c.changeIds[0]} ↔ ${c.changeIds[1]}: ${c.detail}`);
    }
    log.blank();
    log.info('Resolution options: serialize the two changes, or land the shared');
    log.info('contract edit on base first and re-branch both from it.');
  } else {
    log.ok('No surface collisions — integration can be automated.');
  }

  log.blank();
  log.info('Deterministic merge order (lowest reserved version first):');
  report.mergeOrder.forEach((id, i) => log.dim(`${i + 1}. ${id}`));
  log.blank();

  process.exit(report.safe ? 0 : 3);
}
