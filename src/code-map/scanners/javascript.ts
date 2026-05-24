import { readFileSync } from 'fs';
import { parse } from '@babel/parser';
import type { ParserPlugin } from '@babel/parser';
import type {
  File,
  Statement,
  ImportDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  Expression,
  ExpressionStatement,
  ClassMethod,
  ClassPrivateMethod,
  Node,
} from '@babel/types';
import type {
  Scanner,
  FileEntry,
  FunctionEntry,
  ClassEntry,
  MethodEntry,
  ImportEntry,
  ConstantEntry,
  TypeDefEntry,
  EnumEntry,
} from '../types.js';
import { canonicalRelPath, isAllCapsConst, isBinary } from './common.js';

/**
 * Plugin set shared by JS and TS scanners — does not include `jsx` or
 * `typescript`, since those are mutually-exclusive on `<X>` syntax and must
 * be picked per-file.
 */
export const COMMON_PLUGINS = [
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'decorators-legacy',
  'topLevelAwait',
  'dynamicImport',
  'optionalChaining',
  'nullishCoalescingOperator',
  'objectRestSpread',
  'asyncGenerators',
  'numericSeparator',
  'logicalAssignment',
] as const satisfies readonly ParserPlugin[];

const JS_PLUGINS: ParserPlugin[] = ['jsx', ...COMMON_PLUGINS];

export function parseSourceWithPlugins(source: string, plugins: ParserPlugin[]): File {
  return parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins,
  });
}

function isCallExpression(node: Expression | null | undefined, callee: string): boolean {
  if (!node || node.type !== 'CallExpression') return false;
  const c = node.callee;
  return c.type === 'Identifier' && c.name === callee;
}

function extractRequireModule(node: Expression | null | undefined): string | null {
  if (!node || node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (c.type !== 'Identifier' || c.name !== 'require') return null;
  const arg = node.arguments[0];
  if (!arg || arg.type !== 'StringLiteral') return null;
  return arg.value;
}

function getLineRange(node: Node): [number, number] {
  const start = node.loc?.start.line ?? 1;
  const end = node.loc?.end.line ?? start;
  return [start, end];
}

function processImportDeclaration(node: ImportDeclaration): ImportEntry {
  const items: string[] = [];
  for (const spec of node.specifiers) {
    if (spec.type === 'ImportDefaultSpecifier') {
      items.push(`default:${spec.local.name}`);
    } else if (spec.type === 'ImportNamespaceSpecifier') {
      items.push(`*:${spec.local.name}`);
    } else if (spec.type === 'ImportSpecifier') {
      const imported = spec.imported;
      items.push(imported.type === 'Identifier' ? imported.name : spec.local.name);
    }
  }
  return {
    module: node.source.value,
    items,
    line: node.loc?.start.line ?? 1,
  };
}

function processFunctionDeclaration(node: FunctionDeclaration, nameOverride?: string): FunctionEntry | null {
  const name = nameOverride ?? node.id?.name;
  if (!name) return null;
  return {
    name,
    lines: getLineRange(node),
    decorators: [],
    async: node.async,
  };
}

function processClassDeclaration(node: ClassDeclaration, nameOverride?: string): ClassEntry | null {
  const name = nameOverride ?? node.id?.name;
  if (!name) return null;

  const methods: MethodEntry[] = [];
  for (const member of node.body.body) {
    if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
      const m = member as ClassMethod | ClassPrivateMethod;
      let methodName: string;
      if (m.key.type === 'Identifier') {
        methodName = m.key.name;
      } else if (m.key.type === 'PrivateName') {
        methodName = `#${m.key.id.name}`;
      } else {
        methodName = '<computed>';
      }
      methods.push({
        name: methodName,
        lines: getLineRange(m),
        async: m.async ?? false,
      });
    }
  }

  return {
    name,
    lines: getLineRange(node),
    methods,
  };
}

function processVariableDeclaration(
  node: VariableDeclaration,
  imports: ImportEntry[],
  constants: ConstantEntry[],
  functions: FunctionEntry[],
): void {
  for (const decl of node.declarations) {
    if (!decl.id || decl.id.type !== 'Identifier') continue;
    const varName = decl.id.name;
    const init = decl.init;

    // require() call
    if (init && isCallExpression(init, 'require')) {
      const mod = extractRequireModule(init);
      if (mod) {
        imports.push({ module: mod, items: [`default:${varName}`], line: node.loc?.start.line ?? 1 });
      }
      continue;
    }

    // ALL_CAPS constant
    if (isAllCapsConst(varName) && init !== null && init !== undefined) {
      constants.push({ name: varName, line: node.loc?.start.line ?? 1 });
      continue;
    }

    // Arrow function or function expression — also covers React patterns like
    // `const Btn = forwardRef(...)` (init is a CallExpression), so we additionally
    // count any uppercase-named const initialised by a CallExpression as a function.
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
      functions.push({
        name: varName,
        lines: getLineRange(node),
        decorators: [],
        async: init.async,
      });
    } else if (
      init &&
      init.type === 'CallExpression' &&
      /^[A-Z]/.test(varName)
    ) {
      // Heuristic: forwardRef/memo/observer-style HOCs producing components.
      functions.push({
        name: varName,
        lines: getLineRange(node),
        decorators: [],
        async: false,
      });
    }
  }
}

/**
 * Extract a TS interface declaration from a node. Returns null if the node is not
 * a TSInterfaceDeclaration (caller passes raw nodes; this guards the type tag).
 */
function processTsInterfaceDeclaration(node: any, exported: boolean): TypeDefEntry | null {
  if (!node || node.type !== 'TSInterfaceDeclaration') return null;
  if (!node.id || node.id.type !== 'Identifier') return null;
  return {
    name: node.id.name,
    lines: getLineRange(node),
    exported,
  };
}

function processTsTypeAliasDeclaration(node: any, exported: boolean): TypeDefEntry | null {
  if (!node || node.type !== 'TSTypeAliasDeclaration') return null;
  if (!node.id || node.id.type !== 'Identifier') return null;
  return {
    name: node.id.name,
    lines: getLineRange(node),
    exported,
  };
}

function processTsEnumDeclaration(node: any, exported: boolean): EnumEntry | null {
  if (!node || node.type !== 'TSEnumDeclaration') return null;
  if (!node.id || node.id.type !== 'Identifier') return null;
  const members: string[] = [];
  for (const m of node.members ?? []) {
    if (!m || !m.id) continue;
    if (m.id.type === 'Identifier') members.push(m.id.name);
    else if (m.id.type === 'StringLiteral') members.push(m.id.value);
  }
  return {
    name: node.id.name,
    lines: getLineRange(node),
    exported,
    members,
  };
}

interface Buckets {
  imports: ImportEntry[];
  constants: ConstantEntry[];
  functions: FunctionEntry[];
  classes: ClassEntry[];
  interfaces: TypeDefEntry[];
  types: TypeDefEntry[];
  enums: EnumEntry[];
}

/**
 * Process a single top-level statement and collect into buckets.
 * Handles export wrappers by unwrapping one level. When `extractTsTypes` is
 * true, also processes TS-specific declarations.
 */
function processStatement(
  stmt: Statement,
  buckets: Buckets,
  extractTsTypes: boolean,
  exportedFromWrapper = false,
): void {
  // Unwrap export declarations
  if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
    processStatement(stmt.declaration as Statement, buckets, extractTsTypes, true);
    return;
  }
  if (stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;
    if (decl.type === 'FunctionDeclaration') {
      const fe = processFunctionDeclaration(decl, decl.id?.name ?? 'default');
      if (fe) buckets.functions.push(fe);
    } else if (decl.type === 'ClassDeclaration') {
      const ce = processClassDeclaration(decl, decl.id?.name ?? 'default');
      if (ce) buckets.classes.push(ce);
    }
    return;
  }

  if (stmt.type === 'ImportDeclaration') {
    buckets.imports.push(processImportDeclaration(stmt));
    return;
  }

  if (stmt.type === 'FunctionDeclaration') {
    const fe = processFunctionDeclaration(stmt);
    if (fe) buckets.functions.push(fe);
    return;
  }

  if (stmt.type === 'ClassDeclaration') {
    const ce = processClassDeclaration(stmt);
    if (ce) buckets.classes.push(ce);
    return;
  }

  if (stmt.type === 'VariableDeclaration') {
    processVariableDeclaration(stmt, buckets.imports, buckets.constants, buckets.functions);
    return;
  }

  // TS-specific declarations — only collected when extractTsTypes is on.
  if (extractTsTypes) {
    const anyStmt = stmt as any;
    if (anyStmt.type === 'TSInterfaceDeclaration') {
      const e = processTsInterfaceDeclaration(anyStmt, exportedFromWrapper);
      if (e) buckets.interfaces.push(e);
      return;
    }
    if (anyStmt.type === 'TSTypeAliasDeclaration') {
      const e = processTsTypeAliasDeclaration(anyStmt, exportedFromWrapper);
      if (e) buckets.types.push(e);
      return;
    }
    if (anyStmt.type === 'TSEnumDeclaration') {
      const e = processTsEnumDeclaration(anyStmt, exportedFromWrapper);
      if (e) buckets.enums.push(e);
      return;
    }
  }

  // Side-effect require(): require('foo')
  if (stmt.type === 'ExpressionStatement') {
    const expr = (stmt as ExpressionStatement).expression;
    if (isCallExpression(expr, 'require')) {
      const mod = extractRequireModule(expr);
      if (mod) {
        buckets.imports.push({ module: mod, items: [], line: stmt.loc?.start.line ?? 1 });
      }
    }
  }
}

export interface ExtractOptions {
  plugins: ParserPlugin[];
  extractTsTypes?: boolean;
}

export interface ExtractResult {
  imports: ImportEntry[];
  constants: ConstantEntry[];
  functions: FunctionEntry[];
  classes: ClassEntry[];
  interfaces: TypeDefEntry[];
  types: TypeDefEntry[];
  enums: EnumEntry[];
}

/**
 * Parse source and extract structural entries. Returns null on catastrophic
 * parse failure (errorRecovery already mitigates most syntax errors).
 */
export function parseAndExtract(source: string, opts: ExtractOptions): ExtractResult | null {
  let ast: File;
  try {
    ast = parseSourceWithPlugins(source, opts.plugins);
  } catch {
    return null;
  }
  const buckets: Buckets = {
    imports: [],
    constants: [],
    functions: [],
    classes: [],
    interfaces: [],
    types: [],
    enums: [],
  };
  for (const stmt of ast.program.body) {
    processStatement(stmt, buckets, !!opts.extractTsTypes);
  }
  return buckets;
}

/**
 * Compute total source lines for a file, treating both LF and CRLF the same and
 * not counting a trailing newline as an extra line.
 */
export function countSourceLines(source: string): number {
  if (source === '') return 0;
  return source.split(/\r?\n/).length - (source.endsWith('\n') || source.endsWith('\r\n') ? 1 : 0);
}

/**
 * Parse JS source and return a FileEntry. Returns null on catastrophic parse failure.
 * (Backward-compatible signature retained for the Vue scanner.)
 */
export function parseJsSource(source: string, relPath: string): FileEntry | null {
  const total_lines = countSourceLines(source);
  const r = parseAndExtract(source, { plugins: JS_PLUGINS, extractTsTypes: false });
  if (!r) return null;
  return {
    path: relPath,
    total_lines,
    imports: r.imports,
    constants: r.constants,
    classes: r.classes,
    functions: r.functions,
  };
}

class JavaScriptScanner implements Scanner {
  readonly extensions = ['.js'] as const;

  async scan(absolutePath: string, repoRoot: string): Promise<FileEntry | null> {
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      throw err;
    }

    if (isBinary(source)) {
      return null;
    }

    const relPath = canonicalRelPath(absolutePath, repoRoot);
    return parseJsSource(source, relPath);
  }
}

export const jsScanner = new JavaScriptScanner();
