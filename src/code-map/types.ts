export interface ImportEntry {
  module: string;            // bare specifier or relative path (".models", "./utils.js")
  items: string[];           // imported symbols ([] for default-only or side-effect imports)
  line: number;              // 1-based, file-relative
}

export interface CallEntry {
  caller: string;             // function/method symbol name, e.g. "handler" or "Service.fetch"
  callee: string;             // best-effort simple/member name, e.g. "loadUser" or "api.get"
  line: number;               // call-site line, 1-based, file-relative
}

export interface ExportEntry {
  name: string;
  kind: 'class' | 'function' | 'constant' | 'interface' | 'type' | 'enum' | 'unknown';
  line: number;
}

export interface ConstantEntry {
  name: string;              // ALL_CAPS identifier (Python) or top-level UPPER const (JS)
  line: number;
}

export interface MethodEntry {
  name: string;
  lines: [number, number];   // [start, end], 1-based, file-relative
  async: boolean;
}

export interface ClassEntry {
  name: string;
  lines: [number, number];
  methods: MethodEntry[];
  extends?: string[];
  implements?: string[];
  exported?: boolean;
}

export interface FunctionEntry {
  name: string;
  lines: [number, number];
  decorators: string[];      // raw source of each decorator; rendered truncated by yaml-writer
  async: boolean;
  exported?: boolean;
}

export interface TypeDefEntry {
  name: string;
  lines: [number, number];
  exported: boolean;
}

export interface EnumEntry {
  name: string;
  lines: [number, number];
  exported: boolean;
  members: string[];         // member identifiers in source order
}

export interface FileEntry {
  path: string;              // repo-relative, forward-slash, NFC-normalized
  total_lines: number;       // 0 for empty files
  imports: ImportEntry[];
  constants: ConstantEntry[];
  classes: ClassEntry[];
  functions: FunctionEntry[];
  calls?: CallEntry[];
  exports?: ExportEntry[];
  // TS-only optional fields. Omitted when scanner doesn't produce them
  // (Python/JS/Vue scanners leave these undefined; renderer skips empty).
  interfaces?: TypeDefEntry[];
  types?: TypeDefEntry[];
  enums?: EnumEntry[];
  /**
   * Set when this entry was carried over from the previous map because the file
   * failed to parse on the latest run (last-good retention — keeps the symbols
   * queryable instead of letting a mid-edit syntax error delete the file from
   * the index). Surfaced only as a header comment by the renderer; never read
   * back as a structured field.
   */
  stale?: boolean;
}

export interface ScannerWarning {
  path: string;
  message: string;
}

export interface ScannerResult {
  entries: FileEntry[];
  warnings: ScannerWarning[];
}

export interface Scanner {
  /** Extensions handled, lowercased, with leading dot. */
  readonly extensions: readonly string[];
  /**
   * Scan one file. Throw on unrecoverable IO; return null if the file is
   * unparseable (caller emits warning + skips). NEVER throw on parse error.
   */
  scan(absolutePath: string, repoRoot: string): Promise<FileEntry | null>;
  /** Optional batch path for scanners that benefit from batching (Python). */
  scanBatch?(absolutePaths: string[], repoRoot: string): Promise<ScannerResult>;
}
