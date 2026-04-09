/** An indexed constitution */
export interface ConstitutionEntry {
  /** Absolute path to the constitution file */
  path: string;
  /** Workspace-relative path */
  relativePath: string;
  /** Spoke/repo name derived from path */
  spokeName: string;
  /** Purpose extracted from the constitution */
  purpose: string;
  /** Directory semantics (what belongs where) */
  directorySemantics: Map<string, string>;
  /** Declared dependencies on other spokes */
  dependencies: string[];
  /** Excluded spokes (confidentiality boundaries) */
  excluded: string[];
  /** Entry points */
  entryPoints: string[];
}

/** A directed reading list for a task */
export interface ReadingList {
  /** Task that prompted this reading list */
  task: string;
  /** Ordered list of files to read */
  items: ReadingItem[];
}

export interface ReadingItem {
  /** File to read */
  path: string;
  /** Why this file is relevant */
  reason: string;
  /** Specific section to focus on (if applicable) */
  section?: string;
  /** Priority (1 = read first) */
  priority: number;
}
