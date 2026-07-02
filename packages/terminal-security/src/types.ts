/**
 * Policy for tool execution
 */
export type ToolPolicy =
  | "allowedWithPermission"
  | "allowedWithoutPermission"
  | "disabled";

export interface TerminalCommandSegment {
  executable: string;
  args: string[];
  operatorAfter?: string;
}

export interface TerminalCommandClassification {
  command: string;
  policy: ToolPolicy;
  segments: TerminalCommandSegment[];
  sandboxed: boolean;
  elevated: boolean;
  requiresNetwork: boolean;
  mutatesFilesystem: boolean;
  hasInterpolation: boolean;
  hasRedirection: boolean;
  reasons: string[];
}
