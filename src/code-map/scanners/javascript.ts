import { readFileSync } from 'fs';
import { parse } from '@babel/parser';
import type {
  File,
  Statement,
  ImportDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  VariableDeclaration,
  Expression,
  ExpressionStatement,
  ClassMethod,
  ClassPrivateMethod,
  Node,
} from '@babel/types';
import type { Scanner, FileEntry, FunctionEntry, ClassEntry, MethodEntry, ImportEntry, ConstantEntry } from '../types.js';
import { canonicalRelPath, isAllCapsConst, isBinary } from './common.js';

const BABEL_PLUGINS = [
  'jsx',
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
] as const;

function parseSource(source: string): File {
  return parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins: [...BABEL_PLUGINS],
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
        async: m.async,
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

    // Arrow function or function expression
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
      functions.push({
        name: varName,
        lines: getLineRange(node),
        decorators: [],
        async: init.async,
      });
    }
  }
}

/**
 * Process a single top-level statement and collect into out arrays.
 * Handles export wrappers by unwrapping one level.
 */
function processStatement(
  stmt: Statement,
  imports: ImportEntry[],
  constants: ConstantEntry[],
  functions: FunctionEntry[],
  classes: ClassEntry[],
): void {
  // Unwrap export declarations
  if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
    processStatement(stmt.declaration, imports, constants, functions, classes);
    return;
  }
  if (stmt.type === 'ExportDefaultDeclaration') {
    const decl = stmt.declaration;
    if (decl.type === 'FunctionDeclaration') {
      const fe = processFunctionDeclaration(decl, decl.id?.name ?? 'default');
      if (fe) functions.push(fe);
    } else if (decl.type === 'ClassDeclaration') {
      const ce = processClassDeclaration(decl, decl.id?.name ?? 'default');
      if (ce) classes.push(ce);
    }
    return;
  }

  if (stmt.type === 'ImportDeclaration') {
    imports.push(processImportDeclaration(stmt));
    return;
  }

  if (stmt.type === 'FunctionDeclaration') {
    const fe = processFunctionDeclaration(stmt);
    if (fe) functions.push(fe);
    return;
  }

  if (stmt.type === 'ClassDeclaration') {
    const ce = processClassDeclaration(stmt);
    if (ce) classes.push(ce);
    return;
  }

  if (stmt.type === 'VariableDeclaration') {
    processVariableDeclaration(stmt, imports, constants, functions);
    return;
  }

  // Side-effect require(): require('foo')
  if (stmt.type === 'ExpressionStatement') {
    const expr = (stmt as ExpressionStatement).expression;
    if (isCallExpression(expr, 'require')) {
      const mod = extractRequireModule(expr);
      if (mod) {
        imports.push({ module: mod, items: [], line: stmt.loc?.start.line ?? 1 });
      }
    }
  }
}

/**
 * Parse JS source and return a FileEntry. Returns null on catastrophic parse failure.
 * Uses errorRecovery so partial ASTs are produced even with syntax errors.
 */
export function parseJsSource(
  source: string,
  relPath: string,
): FileEntry | null {
  // Total lines using split to handle both LF and CRLF
  const total_lines = source.split(/\r?\n/).length - (source.endsWith('\n') || source.endsWith('\r\n') ? 1 : 0);

  let ast: File;
  try {
    ast = parseSource(source);
  } catch (err) {
    // Catastrophic parse failure
    return null;
  }

  const imports: ImportEntry[] = [];
  const constants: ConstantEntry[] = [];
  const functions: FunctionEntry[] = [];
  const classes: ClassEntry[] = [];

  for (const stmt of ast.program.body) {
    processStatement(stmt, imports, constants, functions, classes);
  }

  return {
    path: relPath,
    total_lines,
    imports,
    constants,
    classes,
    functions,
  };
}

class JavaScriptScanner implements Scanner {
  readonly extensions = ['.js'] as const;

  async scan(absolutePath: string, repoRoot: string): Promise<FileEntry | null> {
    let source: string;
    try {
      source = readFileSync(absolutePath, 'utf8');
    } catch (err) {
      throw err;  // IO error — rethrow for caller to handle
    }

    if (isBinary(source)) {
      return null;
    }

    const relPath = canonicalRelPath(absolutePath, repoRoot);
    return parseJsSource(source, relPath);
  }
}

export const jsScanner = new JavaScriptScanner();
