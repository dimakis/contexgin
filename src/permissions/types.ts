/** Permission decision */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** A permission rule */
export interface PermissionRule {
  /** Tool name pattern (supports glob) */
  tool: string;
  /** Decision for matching tools */
  decision: PermissionDecision;
  /** Optional condition for the rule */
  condition?: Record<string, unknown>;
}

/** Permission policy configuration */
export interface PermissionPolicy {
  /** Default decision when no rule matches */
  defaultDecision: PermissionDecision;
  /** Ordered list of rules (first match wins) */
  rules: PermissionRule[];
}

/** Result of evaluating a permission request */
export interface PermissionEvaluation {
  /** The decision */
  decision: PermissionDecision;
  /** Which rule matched (if any) */
  matchedRule?: PermissionRule;
  /** Reason for the decision */
  reason: string;
}
