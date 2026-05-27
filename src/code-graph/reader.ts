import { existsSync, readFileSync } from 'fs';
import type { CodeGraphIndex } from './types.js';

export function graphPathFor(mapPath: string): string {
  const match = mapPath.match(/^(.*?)(?:code-map)(.*)\.ya?ml$/i);
  if (match) return `${match[1]}code-graph${match[2]}.index.json`;
  return `${mapPath.replace(/\.ya?ml$/i, '')}.graph.json`;
}

export function loadCodeGraph(graphPath: string): CodeGraphIndex {
  if (!existsSync(graphPath)) {
    throw new Error(`${graphPath} is missing; run \`cdd-kit code-map\` first.`);
  }
  const raw = JSON.parse(readFileSync(graphPath, 'utf8')) as CodeGraphIndex;
  if (!raw || raw.schema_version !== '1.0' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error(`${graphPath} is not a cdd-kit code graph v1 index.`);
  }
  return raw;
}
