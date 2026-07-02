/**
 * Provider-neutral local equivalents for CursorApp's client-side tool surface.
 * UI/runtime operations intentionally stay out of the LLM tool list while still
 * sharing the same core, agent runtime, permissions, and CLI implementations.
 */
export const CURSOR_LOCAL_CAPABILITIES = {
  CLIENT_SIDE_TOOL_V2_AI_ATTRIBUTION: "agent-line-attribution",
  CLIENT_SIDE_TOOL_V2_APPLY_AGENT_DIFF: "multi_edit",
  CLIENT_SIDE_TOOL_V2_ASK_QUESTION: "conversation-input",
  CLIENT_SIDE_TOOL_V2_AWAIT: "background-jobs",
  CLIENT_SIDE_TOOL_V2_AWAIT_TASK: "agent-runtime",
  CLIENT_SIDE_TOOL_V2_BACKGROUND_COMPOSER_FOLLOWUP: "agent-queue",
  CLIENT_SIDE_TOOL_V2_CALL_MCP_TOOL: "mcp-tools",
  CLIENT_SIDE_TOOL_V2_COMPUTER_USE: "browser-automation",
  CLIENT_SIDE_TOOL_V2_CREATE_DIAGRAM: "markdown-mermaid",
  CLIENT_SIDE_TOOL_V2_CREATE_PLAN: "agent-plans",
  CLIENT_SIDE_TOOL_V2_DEEP_SEARCH: "codebase",
  CLIENT_SIDE_TOOL_V2_DELETE_FILE: "delete_file",
  CLIENT_SIDE_TOOL_V2_EDIT_FILE: "edit_existing_file",
  CLIENT_SIDE_TOOL_V2_EDIT_FILE_V2: "multi_edit",
  CLIENT_SIDE_TOOL_V2_FETCH_PULL_REQUEST: "git-host-adapter",
  CLIENT_SIDE_TOOL_V2_FETCH_RULES: "request_rule",
  CLIENT_SIDE_TOOL_V2_FILE_SEARCH: "file_glob_search",
  CLIENT_SIDE_TOOL_V2_FIX_LINTS: "read_lints+multi_edit",
  CLIENT_SIDE_TOOL_V2_GENERATE_IMAGE: "image-plugin-or-mcp",
  CLIENT_SIDE_TOOL_V2_GET_MCP_TOOLS: "mcp-tools",
  CLIENT_SIDE_TOOL_V2_GLOB_FILE_SEARCH: "file_glob_search",
  CLIENT_SIDE_TOOL_V2_GO_TO_DEFINITION: "go_to_definition",
  CLIENT_SIDE_TOOL_V2_KNOWLEDGE_BASE: "docs-index",
  CLIENT_SIDE_TOOL_V2_LIST_DIR: "ls",
  CLIENT_SIDE_TOOL_V2_LIST_DIR_V2: "ls",
  CLIENT_SIDE_TOOL_V2_LIST_MCP_RESOURCES: "mcp-resources",
  CLIENT_SIDE_TOOL_V2_MCP: "mcp-tools",
  CLIENT_SIDE_TOOL_V2_MCP_AUTH: "mcp-oauth",
  CLIENT_SIDE_TOOL_V2_READ_FILE: "read_file",
  CLIENT_SIDE_TOOL_V2_READ_FILE_V2: "read_file_range",
  CLIENT_SIDE_TOOL_V2_READ_LINTS: "read_lints",
  CLIENT_SIDE_TOOL_V2_READ_MCP_RESOURCE: "mcp-resources",
  CLIENT_SIDE_TOOL_V2_READ_PROJECT: "view_repo_map",
  CLIENT_SIDE_TOOL_V2_READ_SEMSEARCH_FILES: "codebase",
  CLIENT_SIDE_TOOL_V2_REAPPLY: "multi_edit",
  CLIENT_SIDE_TOOL_V2_RECORD_SCREEN: "browser-recording",
  CLIENT_SIDE_TOOL_V2_REFLECT: "reasoning",
  CLIENT_SIDE_TOOL_V2_REPORT_BUGFIX_RESULTS: "agent-review",
  CLIENT_SIDE_TOOL_V2_RIPGREP_RAW_SEARCH: "grep_search",
  CLIENT_SIDE_TOOL_V2_RIPGREP_SEARCH: "grep_search",
  CLIENT_SIDE_TOOL_V2_RUN_TERMINAL_COMMAND_V2: "run_terminal_command",
  CLIENT_SIDE_TOOL_V2_SEARCH_SYMBOLS: "search_symbols",
  CLIENT_SIDE_TOOL_V2_SEMANTIC_SEARCH_FULL: "codebase",
  CLIENT_SIDE_TOOL_V2_SEND_TO_USER: "conversation-output",
  CLIENT_SIDE_TOOL_V2_SWITCH_MODE: "composer-mode",
  CLIENT_SIDE_TOOL_V2_TASK: "agent-runtime",
  CLIENT_SIDE_TOOL_V2_TASK_V2: "agent-runtime",
  CLIENT_SIDE_TOOL_V2_TODO_READ: "agent-plans",
  CLIENT_SIDE_TOOL_V2_TODO_WRITE: "agent-plans",
  CLIENT_SIDE_TOOL_V2_UPDATE_PROJECT: "multi_edit+write_file",
  CLIENT_SIDE_TOOL_V2_WEB_FETCH: "fetch_url_content",
  CLIENT_SIDE_TOOL_V2_WEB_SEARCH: "search_web",
  CLIENT_SIDE_TOOL_V2_WRITE_SHELL_STDIN: "background-terminal-input",
} as const;

export type CursorLocalCapabilityName = keyof typeof CURSOR_LOCAL_CAPABILITIES;

export function resolveCursorLocalCapability(name: string): string | undefined {
  return CURSOR_LOCAL_CAPABILITIES[name as CursorLocalCapabilityName];
}
