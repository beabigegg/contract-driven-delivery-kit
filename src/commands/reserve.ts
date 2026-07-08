/**
 * `cdd-kit reserve` — allocate a contract version lane for a change before it
 * is developed in a parallel worktree (ADR 0009).
 *
 * Run this on the base branch, before branching, once per (change, contract)
 * the change will touch. It records the current on-base version and a distinct
 * reserved target so concurrent changes never collide on a contract's
 * `schema-version` line or produce a version skip the validator rejects.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import { log } from '../utils/logger.js';
import { reservationsSchema, CONTRACT_KEYS, type ContractKey } from '../schemas/reservations.schema.js';
import {
  RESERVATIONS_PATH,
  emptyLedger,
  nextFreeVersion,
  readContractVersion,
  type BumpKind,
  type Reservation,
  type ReservationsFile,
} from './parallel-shared.js';

export interface ReserveOptions {
  changeId: string;
  contract: ContractKey;
  bump: BumpKind;
  surfaces: string[];
  branch?: string;
  json?: boolean;
}

function loadLedger(repoRoot: string): ReservationsFile {
  const p = join(repoRoot, RESERVATIONS_PATH);
  if (!existsSync(p)) return emptyLedger();
  const data = yaml.load(readFileSync(p, 'utf8'), { schema: yaml.JSON_SCHEMA });
  if (!data || typeof data !== 'object') return emptyLedger();
  const ledger = data as ReservationsFile;
  if (!Array.isArray(ledger.reservations)) ledger.reservations = [];
  ledger.version = 1;
  return ledger;
}

function writeLedger(repoRoot: string, ledger: ReservationsFile): void {
  const p = join(repoRoot, RESERVATIONS_PATH);
  mkdirSync(dirname(p), { recursive: true });
  const header = '# .cdd/reservations.yml — contract-lane reservations (cdd-kit reserve / integrate, ADR 0009)\n';
  writeFileSync(p, header + yaml.dump(ledger, { lineWidth: -1, noRefs: true, sortKeys: false }), 'utf8');
}

export async function reserve(opts: ReserveOptions): Promise<void> {
  const repoRoot = process.cwd();

  if (!CONTRACT_KEYS.includes(opts.contract)) {
    log.error(`Invalid contract: ${opts.contract}. Use one of: ${CONTRACT_KEYS.join(', ')}`);
    process.exit(1);
  }

  const ledger = loadLedger(repoRoot);
  const from = readContractVersion(repoRoot, opts.contract);
  const to = nextFreeVersion(opts.contract, from, opts.bump, ledger, opts.changeId);

  let entry = ledger.reservations.find(r => r['change-id'] === opts.changeId);
  if (!entry) {
    entry = { 'change-id': opts.changeId, contracts: {} } as Reservation;
    ledger.reservations.push(entry);
  }
  if (opts.branch) entry.branch = opts.branch;
  entry['changelog-fragment'] = `contracts/changelog.d/${opts.changeId}.md`;
  entry.contracts[opts.contract] = {
    from,
    to,
    ...(opts.surfaces.length ? { surfaces: opts.surfaces } : {}),
  };

  // Validate before writing — a derived ledger must never ship malformed.
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(reservationsSchema);
  if (!validate(ledger)) {
    log.error('Reservation ledger failed schema validation:');
    for (const e of validate.errors ?? []) log.dim(`${e.instancePath} ${e.message}`);
    process.exit(1);
  }

  writeLedger(repoRoot, ledger);

  if (opts.json) {
    console.log(JSON.stringify({ changeId: opts.changeId, contract: opts.contract, from, to, surfaces: opts.surfaces }, null, 2));
    return;
  }

  log.ok(`Reserved ${opts.contract} lane for ${opts.changeId}: ${from} → ${to}`);
  if (opts.surfaces.length) log.dim(`surfaces: ${opts.surfaces.join(', ')}`);
  log.dim(`changelog fragment: contracts/changelog.d/${opts.changeId}.md`);
  log.dim(`ledger: ${RESERVATIONS_PATH}`);
}
