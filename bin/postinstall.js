#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const cliPath = join(__dirname, '..', 'dist', 'cli', 'index.js');
  if (!existsSync(cliPath)) process.exit(0);

  spawnSync(process.execPath, [cliPath, 'update', '--postinstall'], {
    stdio: 'inherit',
    timeout: 30_000,
  });
  process.exit(0);
} catch {
  process.exit(0);
}
