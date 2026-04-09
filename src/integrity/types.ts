/** A testable claim extracted from a context file */
export interface Claim {
  /** Source file containing the claim */
  source: string;
  /** What is being claimed */
  assertion: string;
  /** Type of claim determines validation strategy */
  kind: 'file_exists' | 'directory_exists' | 'entry_point' | 'boundary' | 'structural';
  /** The specific value to validate (path, name, etc.) */
  target: string;
  /** Line number in source file */
  line: number;
}

/** Result of validating a claim */
export interface ClaimResult {
  claim: Claim;
  valid: boolean;
  /** What was actually found (if different from claimed) */
  actual?: string;
  /** Human-readable explanation */
  message: string;
}

/** A drift report for a workspace */
export interface DriftReport {
  /** When this report was generated */
  timestamp: Date;
  /** Workspace root */
  workspaceRoot: string;
  /** All claims checked */
  results: ClaimResult[];
  /** Only the invalid claims */
  drift: ClaimResult[];
  /** Summary statistics */
  summary: {
    total: number;
    valid: number;
    invalid: number;
    byKind: Record<string, { total: number; invalid: number }>;
  };
}
