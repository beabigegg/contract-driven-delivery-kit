export interface ImportEntry {
  module: string;            // bare specifier or relative path (".models", "./utils.js")
  items: string[];           // imported symbols ([] for default-only or side-effect imports)
  line: number;              // 1-based, file-relative
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
}

export interface FunctionEntry {
  name: string;
  lines: [number, number];
  decorators: string[];      // raw source of each decorator; rendered truncated by yaml-writer
  async: boolean;
}

export interface FileEntry {
  path: string;              // repo-relative, forward-slash, NFC-normalized
  total_lines: number;       // 0 for empty files
  imports: ImportEntry[];
  constants: ConstantEntry[];
  classes: ClassEntry[];
  functions: FunctionEntry[];
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
