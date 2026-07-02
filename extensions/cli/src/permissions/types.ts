import { ToolCallPreview } from "../tools/types.js";

export type PermissionPolicy = "allow" | "ask" | "exclude";

export type PermissionMode =
  | "normal"
  | "plan"
  | "sandbox"
  | "autonomous"
  | "auto";

export interface ToolPermissionPolicy {
  /** The tool name to match against */
  tool: string;
  /** The permission to apply */
  permission: PermissionPolicy;
  /** Optional argument matching patterns. If not specified, applies to all calls to this tool */
  argumentMatches?: Record<string, any>;
}

export interface ToolPermissions {
  /** Array of permission policies that are evaluated in order */
  policies: ToolPermissionPolicy[];
  /** Let dynamic command classification escalate an allow decision to ask. */
  respectDynamicSecurity?: boolean;
  /** Full access intentionally bypasses dynamic command classification. */
  bypassSecurity?: boolean;
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, any>;
  preview?: ToolCallPreview[];
}

export interface PermissionCheckResult {
  permission: PermissionPolicy;
  /** The policy that matched this tool call */
  matchedPolicy?: ToolPermissionPolicy;
}
