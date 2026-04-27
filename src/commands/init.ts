import { join } from 'path';
import { rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { ASSET, ASSETS_DIR, AGENTS_HOME, SKILLS_HOME } from '../utils/paths.js';
import { copyDirTracked, copyFileTracked } from '../utils/copy.js';
import { log } from '../utils/logger.js';
import { detectStack, type StackKind } from '../utils/stack-detect.js';

export interface InitOptions {
  globalOnly: boolean;
  localOnly: boolean;
  force: boolean;
}

/**
 * Read the conda environment name from environment.yml in the project root.
 * Returns 'base' if the file is missing or the name field cannot be parsed.
 */
function readCondaEnvName(cwd: string): string {
  const envYml = join(cwd, 'environment.yml');
  if (!existsSync(envYml)) return 'base';
  try {
    const content = readFileSync(envYml, 'utf8');
    const match = content.match(/^name:\s*(.+)$/m);
    return match ? match[1].trim() : 'base';
  } catch {
    return 'base';
  }
}

/**
 * Load a CI template fragment for the given stack.
 * Returns null if the template file doesn't exist.
 */
function loadCiTemplate(stack: StackKind): string | null {
  // Templates live in assets/ci-templates/ at package root
  const templatePath = join(ASSETS_DIR, 'ci-templates', `${stack}.yml`);
  if (!existsSync(templatePath)) return null;
  try {
    return readFileSync(templatePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Replace the placeholder fast-gate step inside the contract-driven-gates.yml
 * with the stack-specific fragment. The replacement is surgical — only the
 * "Repository-specific fast gate" step is replaced; the rest of the yml is
 * preserved verbatim.
 *
 * Strategy: find the `      - name: Repository-specific fast gate` step and
 * replace everything up to the next top-level step marker (line starting with
 * `  ` + `-` at job-level, i.e. `      - ` prefix) or next job key.
 * We use a line-scan rather than a YAML parser to avoid pulling in a heavy
 * dependency and to preserve all comments and formatting exactly.
 */
function patchFastGateYml(baseYml: string, fragment: string, stack: StackKind): string {
  const lines = baseYml.split('\n');

  // Find the line index of the placeholder step name
  const PLACEHOLDER_NAME = '      - name: Repository-specific fast gate';
  const startIdx = lines.findIndex(l => l.startsWith(PLACEHOLDER_NAME));

  if (startIdx === -1) {
    // Placeholder already replaced or yml structure changed — leave as-is
    return baseYml;
  }

  // Walk forward to find the end of this step (next step at same indent, or
  // next job-level key, or EOF)
  // Steps are indented 6 spaces ("      - "); the next step starts with "      - "
  // but NOT at a deeper indent. We stop at the first line starting with "      - "
  // that is NOT part of the current step's run block.
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const line = lines[endIdx];
    // A new step at the same level starts with "      - " (6 spaces + "- ")
    // OR a job-level key (2 spaces + non-space, like "  e2e-critical:")
    if (
      (line.startsWith('      - ') && endIdx > startIdx) ||
      (line.match(/^  \S/) && !line.startsWith('      '))
    ) {
      break;
    }
    endIdx++;
  }

  // Build the replacement lines from the fragment
  // Each fragment line is indented with 6 spaces (step level) to align with
  // the existing workflow structure
  const fragmentLines = fragment
    .trimEnd()
    .split('\n')
    .map(l => (l === '' ? '' : '      ' + l));

  const before = lines.slice(0, startIdx);
  const after  = lines.slice(endIdx);

  return [...before, ...fragmentLines, ...after].join('\n');
}

export async function init(opts: InitOptions): Promise<void> {
  if (opts.globalOnly && opts.localOnly) {
    log.error('--global-only and --local-only are mutually exclusive.');
    process.exit(1);
  }

  const cwd = process.cwd();
  const createdPaths: string[] = [];

  function track(paths: string[]): void {
    createdPaths.push(...paths);
  }

  function rollback(): void {
    log.warn('Rolling back created paths due to error…');
    // Remove in reverse order so files are deleted before their parent dirs
    for (const p of [...createdPaths].reverse()) {
      try {
        rmSync(p, { recursive: true, force: true });
        log.dim(`rolled back: ${p}`);
      } catch {
        log.warn(`could not remove: ${p}`);
      }
    }
  }

  log.blank();
  log.info('Initialising contract-driven-delivery kit…');
  log.blank();

  try {
    // ── Global: install agents + skill into ~/.claude ───────────────────────
    if (!opts.localOnly) {
      log.info(`Installing agents → ${AGENTS_HOME}`);
      const { count: agentCount, created: agentCreated } = copyDirTracked(ASSET.agents, AGENTS_HOME, { overwrite: true });
      track(agentCreated);
      log.ok(`${agentCount} agent file(s) installed.`);

      const skillDirs = readdirSync(ASSET.skills, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      let totalSkillFiles = 0;
      for (const skillName of skillDirs) {
        const skillDest = join(SKILLS_HOME, skillName);
        log.info(`Installing skill  → ${skillDest}`);
        const { count, created } = copyDirTracked(join(ASSET.skills, skillName), skillDest, { overwrite: true });
        track(created);
        totalSkillFiles += count;
      }
      log.ok(`${totalSkillFiles} skill file(s) installed (${skillDirs.length} skills).`);

      log.blank();
    }

    // ── Local: copy project scaffolding into cwd ────────────────────────────
    if (!opts.globalOnly) {
      log.info(`Scaffolding project files in ${cwd}`);

      const { count: contractsCount, created: contractsCreated } = copyDirTracked(
        ASSET.contracts,
        join(cwd, 'contracts'),
        { overwrite: opts.force, label: 'contracts' },
      );
      track(contractsCreated);
      log.ok(`contracts/ — ${contractsCount} file(s) written.`);

      const { count: specsCount, created: specsCreated } = copyDirTracked(
        ASSET.specsTemplates,
        join(cwd, 'specs', 'templates'),
        { overwrite: opts.force, label: 'specs/templates' },
      );
      track(specsCreated);
      log.ok(`specs/templates/ — ${specsCount} file(s) written.`);

      const { count: testsCount, created: testsCreated } = copyDirTracked(
        ASSET.testsTemplates,
        join(cwd, 'tests', 'templates'),
        { overwrite: opts.force, label: 'tests/templates' },
      );
      track(testsCreated);
      log.ok(`tests/templates/ — ${testsCount} file(s) written.`);

      const { count: ciCount, created: ciCreated } = copyDirTracked(
        ASSET.ci,
        join(cwd, 'ci'),
        { overwrite: opts.force, label: 'ci' },
      );
      track(ciCreated);
      log.ok(`ci/ — ${ciCount} file(s) written.`);

      const { count: wfCount, created: wfCreated } = copyDirTracked(
        ASSET.githubWorkflows,
        join(cwd, '.github', 'workflows'),
        { overwrite: opts.force, label: '.github/workflows' },
      );
      track(wfCreated);
      log.ok(`.github/workflows/ — ${wfCount} file(s) written.`);

      // ── Stack detection + CI yml patching ──────────────────────────────
      const detection = detectStack(cwd);

      if (detection.polyglot) {
        // Find second language family for the warning message
        const PYTHON_STACKS: StackKind[] = ['conda', 'poetry', 'uv', 'pip'];
        const JS_STACKS:     StackKind[] = ['pnpm', 'bun', 'yarn', 'npm'];
        const other = detection.candidates.find(c => {
          if (PYTHON_STACKS.includes(detection.primary as StackKind)) return !PYTHON_STACKS.includes(c);
          if (JS_STACKS.includes(detection.primary as StackKind))     return !JS_STACKS.includes(c);
          return c !== detection.primary;
        });
        log.warn(
          `Polyglot detected: ${detection.primary} and ${other ?? detection.candidates[1]}. ` +
          `Generated config for ${detection.primary}.`,
        );
      } else if (detection.primary !== 'unknown') {
        log.info(`Detected stack: ${detection.primary}`);
      } else {
        log.warn('Could not detect stack — CI placeholder left in place.');
      }

      // Patch the fast-gate step in the generated CI yml
      const ciYmlDest = join(cwd, '.github', 'workflows', 'contract-driven-gates.yml');
      if (existsSync(ciYmlDest)) {
        const template = loadCiTemplate(detection.primary);
        if (template) {
          const original = readFileSync(ciYmlDest, 'utf8');
          let patched  = patchFastGateYml(original, template, detection.primary);
          // Replace conda env name placeholder with the actual name from environment.yml
          if (detection.primary === 'conda' && patched.includes('{{conda-env-name}}')) {
            const envName = readCondaEnvName(cwd);
            patched = patched.replace(/\{\{conda-env-name\}\}/g, envName);
            log.ok(`Conda environment name set to: ${envName}`);
          }
          if (patched !== original) {
            writeFileSync(ciYmlDest, patched, 'utf8');
            log.ok(`CI fast-gate patched for stack: ${detection.primary}`);
          }
        }
      }

      // CLAUDE.md — never overwrite
      const { written: claudeWritten, created: claudeCreated } = copyFileTracked(
        ASSET.claudeTemplate,
        join(cwd, 'CLAUDE.md'),
        { overwrite: false, label: 'CLAUDE.md' },
      );
      if (claudeCreated) track([join(cwd, 'CLAUDE.md')]);
      if (claudeWritten) log.ok('CLAUDE.md created.');

      // AGENTS.md — never overwrite
      const { written: agentsWritten, created: agentsCreated } = copyFileTracked(
        ASSET.agentsTemplate,
        join(cwd, 'AGENTS.md'),
        { overwrite: false, label: 'AGENTS.md' },
      );
      if (agentsCreated) track([join(cwd, 'AGENTS.md')]);
      if (agentsWritten) log.ok('AGENTS.md created.');

      log.blank();
    }
  } catch (err) {
    log.error(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
    rollback();
    process.exit(1);
  }

  log.ok('Done.');
  log.blank();
  log.info('Use the contract-driven-delivery skill in Claude Code to scan this repo.');
  log.blank();
}
