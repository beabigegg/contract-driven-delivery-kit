import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type StackKind =
  | 'conda' | 'poetry' | 'uv' | 'pip'
  | 'pnpm' | 'bun' | 'yarn' | 'npm'
  | 'go' | 'rust' | 'unknown';

export interface DetectionResult {
  primary: StackKind;
  candidates: StackKind[];  // all detected, in order
  polyglot: boolean;
}

/** Safely check if a file exists; returns false on permission errors */
function safeExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

/** Safely read a file as text; returns empty string on any error */
function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/** Detect Python package manager (returns null if no Python project found) */
function detectPython(repoRoot: string): StackKind | null {
  // conda: environment.yml, conda-lock.yml, or meta.yaml
  if (
    safeExists(join(repoRoot, 'environment.yml')) ||
    safeExists(join(repoRoot, 'conda-lock.yml')) ||
    safeExists(join(repoRoot, 'meta.yaml'))
  ) {
    return 'conda';
  }

  // pyproject.toml: poetry takes priority over uv
  if (safeExists(join(repoRoot, 'pyproject.toml'))) {
    const content = safeRead(join(repoRoot, 'pyproject.toml'));
    if (content.includes('[tool.poetry]')) {
      return 'poetry';
    }
    return 'uv';
  }

  // requirements.txt → pip
  if (safeExists(join(repoRoot, 'requirements.txt'))) {
    return 'pip';
  }

  return null;
}

/** Detect JavaScript package manager (returns null if no JS project found) */
function detectJS(repoRoot: string): StackKind | null {
  if (!safeExists(join(repoRoot, 'package.json'))) {
    return null;
  }

  if (safeExists(join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (safeExists(join(repoRoot, 'bun.lockb')))      return 'bun';
  if (safeExists(join(repoRoot, 'yarn.lock')))       return 'yarn';
  return 'npm';
}

/** Detect Go project */
function detectGo(repoRoot: string): StackKind | null {
  return safeExists(join(repoRoot, 'go.mod')) ? 'go' : null;
}

/** Detect Rust project */
function detectRust(repoRoot: string): StackKind | null {
  return safeExists(join(repoRoot, 'Cargo.toml')) ? 'rust' : null;
}

export function detectStack(repoRoot: string): DetectionResult {
  // Gather all detected stacks in priority order
  const candidates: StackKind[] = [];

  const python = detectPython(repoRoot);
  if (python) candidates.push(python);

  const js = detectJS(repoRoot);
  if (js) candidates.push(js);

  const go = detectGo(repoRoot);
  if (go) candidates.push(go);

  const rust = detectRust(repoRoot);
  if (rust) candidates.push(rust);

  if (candidates.length === 0) {
    return { primary: 'unknown', candidates: [], polyglot: false };
  }

  // Polyglot: more than one distinct language family detected
  const PYTHON_STACKS: StackKind[] = ['conda', 'poetry', 'uv', 'pip'];
  const JS_STACKS:     StackKind[] = ['pnpm', 'bun', 'yarn', 'npm'];

  const hasPython  = candidates.some(c => PYTHON_STACKS.includes(c));
  const hasJS      = candidates.some(c => JS_STACKS.includes(c));
  const hasGo      = candidates.includes('go');
  const hasRust    = candidates.includes('rust');

  const languageCount = [hasPython, hasJS, hasGo, hasRust].filter(Boolean).length;
  const polyglot = languageCount > 1;

  return {
    primary: candidates[0],
    candidates,
    polyglot,
  };
}
