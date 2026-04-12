import type { PermissionPolicy, PermissionEvaluation } from './types.js';

/**
 * Evaluate a permission request against a policy.
 * First matching rule wins.
 */
export function evaluatePermission(
  toolName: string,
  policy: PermissionPolicy,
): PermissionEvaluation {
  for (const rule of policy.rules) {
    if (matchesToolPattern(toolName, rule.tool)) {
      return {
        decision: rule.decision,
        matchedRule: rule,
        reason: `Matched rule: ${rule.tool} -> ${rule.decision}`,
      };
    }
  }

  return {
    decision: policy.defaultDecision,
    reason: `No matching rule, using default: ${policy.defaultDecision}`,
  };
}

/**
 * Match a tool name against a pattern (supports * glob).
 */
function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === toolName) return true;

  // Simple glob: convert * to regex .*
  const regexStr = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr).test(toolName);
}
