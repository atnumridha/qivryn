import { BuiltInToolNames } from "./builtIn";

export enum LocalCapabilityKind {
  Tool = "tool",
  UiAction = "ui-action",
  RuntimeControl = "runtime-control",
  Renderer = "renderer",
  ExternalProvider = "external-provider",
  Unsupported = "unsupported",
}

export enum LocalCapabilitySurface {
  Core = "core",
  Cli = "cli",
  VsCode = "vscode",
  JetBrains = "jetbrains",
}

export interface CursorLocalCapability {
  kind: LocalCapabilityKind;
  implementation: string;
  executable: boolean;
  surfaces: LocalCapabilitySurface[];
  toolName?: BuiltInToolNames;
  reason?: string;
}

const allSurfaces = [
  LocalCapabilitySurface.Core,
  LocalCapabilitySurface.Cli,
  LocalCapabilitySurface.VsCode,
  LocalCapabilitySurface.JetBrains,
];
const editorSurfaces = [
  LocalCapabilitySurface.VsCode,
  LocalCapabilitySurface.JetBrains,
];

const tool = (toolName: BuiltInToolNames): CursorLocalCapability => ({
  kind: LocalCapabilityKind.Tool,
  implementation: toolName,
  executable: true,
  surfaces: allSurfaces,
  toolName,
});
const runtime = (implementation: string): CursorLocalCapability => ({
  kind: LocalCapabilityKind.RuntimeControl,
  implementation,
  executable: false,
  surfaces: allSurfaces,
});
const ui = (implementation: string): CursorLocalCapability => ({
  kind: LocalCapabilityKind.UiAction,
  implementation,
  executable: false,
  surfaces: editorSurfaces,
});
const renderer = (implementation: string): CursorLocalCapability => ({
  kind: LocalCapabilityKind.Renderer,
  implementation,
  executable: false,
  surfaces: editorSurfaces,
});
const provider = (implementation: string): CursorLocalCapability => ({
  kind: LocalCapabilityKind.ExternalProvider,
  implementation,
  executable: false,
  surfaces: allSurfaces,
});
const unsupported = (reason: string): CursorLocalCapability => ({
  kind: LocalCapabilityKind.Unsupported,
  implementation: "unsupported",
  executable: false,
  surfaces: [],
  reason,
});

export const CURSOR_LOCAL_CAPABILITIES = {
  CLIENT_SIDE_TOOL_V2_AI_ATTRIBUTION: ui("agent-line-attribution"),
  CLIENT_SIDE_TOOL_V2_APPLY_AGENT_DIFF: tool(BuiltInToolNames.MultiEdit),
  CLIENT_SIDE_TOOL_V2_ASK_QUESTION: ui("conversation-input"),
  CLIENT_SIDE_TOOL_V2_AWAIT: runtime("terminal-jobs"),
  CLIENT_SIDE_TOOL_V2_AWAIT_TASK: runtime("agent-runtime"),
  CLIENT_SIDE_TOOL_V2_BACKGROUND_COMPOSER_FOLLOWUP: runtime("agent-queue"),
  CLIENT_SIDE_TOOL_V2_CALL_MCP_TOOL: provider("mcp-tools"),
  CLIENT_SIDE_TOOL_V2_COMPUTER_USE: tool(BuiltInToolNames.ComputerUse),
  CLIENT_SIDE_TOOL_V2_CREATE_DIAGRAM: renderer("markdown-mermaid"),
  CLIENT_SIDE_TOOL_V2_CREATE_PLAN: tool(BuiltInToolNames.UpdatePlan),
  CLIENT_SIDE_TOOL_V2_DEEP_SEARCH: tool(BuiltInToolNames.CodebaseTool),
  CLIENT_SIDE_TOOL_V2_DELETE_FILE: tool(BuiltInToolNames.DeleteFile),
  CLIENT_SIDE_TOOL_V2_EDIT_FILE: tool(BuiltInToolNames.EditExistingFile),
  CLIENT_SIDE_TOOL_V2_EDIT_FILE_V2: tool(BuiltInToolNames.MultiEdit),
  CLIENT_SIDE_TOOL_V2_FETCH_PULL_REQUEST: provider("git-host-adapter"),
  CLIENT_SIDE_TOOL_V2_FETCH_RULES: tool(BuiltInToolNames.RequestRule),
  CLIENT_SIDE_TOOL_V2_FILE_SEARCH: tool(BuiltInToolNames.FileGlobSearch),
  CLIENT_SIDE_TOOL_V2_FIX_LINTS: runtime("read-lints-then-edit"),
  CLIENT_SIDE_TOOL_V2_GENERATE_IMAGE: provider("image-plugin-or-mcp"),
  CLIENT_SIDE_TOOL_V2_GET_MCP_TOOLS: provider("mcp-tools"),
  CLIENT_SIDE_TOOL_V2_GLOB_FILE_SEARCH: tool(BuiltInToolNames.FileGlobSearch),
  CLIENT_SIDE_TOOL_V2_GO_TO_DEFINITION: tool(BuiltInToolNames.GoToDefinition),
  CLIENT_SIDE_TOOL_V2_KNOWLEDGE_BASE: provider("docs-index"),
  CLIENT_SIDE_TOOL_V2_LIST_DIR: tool(BuiltInToolNames.LSTool),
  CLIENT_SIDE_TOOL_V2_LIST_DIR_V2: tool(BuiltInToolNames.LSTool),
  CLIENT_SIDE_TOOL_V2_LIST_MCP_RESOURCES: provider("mcp-resources"),
  CLIENT_SIDE_TOOL_V2_MCP: provider("mcp-tools"),
  CLIENT_SIDE_TOOL_V2_MCP_AUTH: provider("mcp-oauth"),
  CLIENT_SIDE_TOOL_V2_READ_FILE: tool(BuiltInToolNames.ReadFile),
  CLIENT_SIDE_TOOL_V2_READ_FILE_V2: tool(BuiltInToolNames.ReadFileRange),
  CLIENT_SIDE_TOOL_V2_READ_LINTS: tool(BuiltInToolNames.ReadLints),
  CLIENT_SIDE_TOOL_V2_READ_MCP_RESOURCE: provider("mcp-resources"),
  CLIENT_SIDE_TOOL_V2_READ_PROJECT: tool(BuiltInToolNames.ViewRepoMap),
  CLIENT_SIDE_TOOL_V2_READ_SEMSEARCH_FILES: tool(BuiltInToolNames.CodebaseTool),
  CLIENT_SIDE_TOOL_V2_REAPPLY: tool(BuiltInToolNames.MultiEdit),
  CLIENT_SIDE_TOOL_V2_RECORD_SCREEN: runtime("browser-recording"),
  CLIENT_SIDE_TOOL_V2_REFLECT: renderer("reasoning"),
  CLIENT_SIDE_TOOL_V2_REPORT_BUGFIX_RESULTS: runtime("agent-review"),
  CLIENT_SIDE_TOOL_V2_RIPGREP_RAW_SEARCH: tool(BuiltInToolNames.GrepSearch),
  CLIENT_SIDE_TOOL_V2_RIPGREP_SEARCH: tool(BuiltInToolNames.GrepSearch),
  CLIENT_SIDE_TOOL_V2_RUN_TERMINAL_COMMAND_V2: tool(
    BuiltInToolNames.RunTerminalCommand,
  ),
  CLIENT_SIDE_TOOL_V2_SEARCH_SYMBOLS: tool(BuiltInToolNames.SearchSymbols),
  CLIENT_SIDE_TOOL_V2_SEMANTIC_SEARCH_FULL: tool(BuiltInToolNames.CodebaseTool),
  CLIENT_SIDE_TOOL_V2_SEND_TO_USER: ui("conversation-output"),
  CLIENT_SIDE_TOOL_V2_SWITCH_MODE: ui("composer-mode"),
  CLIENT_SIDE_TOOL_V2_TASK: runtime("agent-runtime"),
  CLIENT_SIDE_TOOL_V2_TASK_V2: runtime("agent-runtime"),
  CLIENT_SIDE_TOOL_V2_TODO_READ: runtime("agent-plans"),
  CLIENT_SIDE_TOOL_V2_TODO_WRITE: tool(BuiltInToolNames.UpdatePlan),
  CLIENT_SIDE_TOOL_V2_UPDATE_PROJECT: runtime("multi-edit-and-write"),
  CLIENT_SIDE_TOOL_V2_WEB_FETCH: tool(BuiltInToolNames.FetchUrlContent),
  CLIENT_SIDE_TOOL_V2_WEB_SEARCH: tool(BuiltInToolNames.SearchWeb),
  CLIENT_SIDE_TOOL_V2_WRITE_SHELL_STDIN: unsupported(
    "Durable terminal jobs do not yet expose interactive stdin through Core.",
  ),
} as const satisfies Record<string, CursorLocalCapability>;

export type CursorLocalCapabilityName = keyof typeof CURSOR_LOCAL_CAPABILITIES;

export function resolveCursorLocalCapability(
  name: string,
): CursorLocalCapability | undefined {
  return CURSOR_LOCAL_CAPABILITIES[name as CursorLocalCapabilityName];
}
