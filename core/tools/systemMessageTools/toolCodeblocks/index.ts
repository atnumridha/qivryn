import { Tool, ToolCallState } from "../../..";
import { SystemMessageToolsFramework } from "../types";
import { handleToolCallBuffer } from "./parseSystemToolCall";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactText(value: string | undefined, maxLength: number): string {
  const normalized = normalizeWhitespace(value ?? "");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function getSchemaType(value: unknown): string {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return "string";
  }

  const type = (value as { type?: unknown }).type;
  return Array.isArray(type)
    ? type.filter((item) => typeof item === "string").join("|") || "string"
    : typeof type === "string"
      ? type
      : "string";
}

function getSchemaDescription(value: unknown): string {
  if (!value || typeof value !== "object" || !("description" in value)) {
    return "";
  }

  const description = (value as { description?: unknown }).description;
  return typeof description === "string" ? description : "";
}

export class SystemMessageToolCodeblocksFramework
  implements SystemMessageToolsFramework
{
  enableImplicitShellCommandToolCalls = false;

  // Poor models are really bad at following instructions, alternate starts allowed:
  acceptedToolCallStarts: [string, string][] = [
    ["```tool\n", "```tool\n"],
    ["tool_name:", "```tool\nTOOL_NAME:"],
  ];

  toolCallStateToSystemToolCall(state: ToolCallState): string {
    let parts = ["```tool"];
    parts.push(`TOOL_NAME: ${state.toolCall.function.name}`);
    try {
      for (const arg in state.parsedArgs) {
        parts.push(`BEGIN_ARG: ${arg}`);
        parts.push(JSON.stringify(state.parsedArgs[arg]));
        parts.push(`END_ARG`);
      }
    } catch (e) {
      console.log("Failed to stringify json args", state.parsedArgs);
    }
    // TODO - include tool call id for parallel. Confuses dumb models
    parts.push("```");
    return parts.join("\n");
  }

  handleToolCallBuffer = handleToolCallBuffer;

  toolToSystemToolDefinition(tool: Tool): string {
    let toolDefinition = `\`\`\`tool_definition\nTOOL_NAME: ${tool.function.name}\n`;

    if (tool.function.description) {
      toolDefinition += `TOOL_DESCRIPTION:\n${tool.function.description}\n`;
    }

    if (tool.function.parameters && "properties" in tool.function.parameters) {
      for (const [key, value] of Object.entries(
        tool.function.parameters.properties as object,
      )) {
        const isRequired = tool.function.parameters.required?.includes(key);
        const requiredText = isRequired ? "required" : "optional";

        let argType = "string";
        if ("type" in value) {
          argType = value.type;
        }
        let argDescription = "";
        if ("description" in value) {
          argDescription = value.description;
        }

        toolDefinition += `TOOL_ARG: ${key} (${argType}, ${requiredText})\n`;
        if (argDescription) {
          toolDefinition += argDescription + "\n";
        }
        toolDefinition += `END_ARG\n`;
      }
    }

    toolDefinition += `\`\`\``;
    return toolDefinition.trim();
  }

  systemMessagePrefix = `You have access to tools. To call a tool, you MUST respond with EXACTLY the tool code block format shown below.

CRITICAL: Follow the exact syntax. Do not use XML tags, JSON objects, or any other format for tool calls.`;

  systemMessageSuffix = `RULES FOR TOOL USE:
1. To call a tool, output a tool code block using EXACTLY the format shown above.
2. Always start the code block on a new line.
3. You can only call ONE tool at a time.
4. The tool code block MUST be the last thing in your response. Stop immediately after the closing fence.
5. Do NOT wrap tool calls in XML tags like <tool_call> or <function=...>.
6. Do NOT use JSON format for tool calls.
7. Do NOT invent tools that are not listed above.
8. If the user's request can be addressed with a listed tool, use it rather than guessing.
9. Do not perform actions with hypothetical files. Use tools to find relevant files.`;

  exampleDynamicToolDefinition = `
\`\`\`tool_definition
TOOL_NAME: example_tool
TOOL_ARG: arg_1 (string, required)
Description of the first argument
END_ARG
TOOL_ARG: arg_2 (number, optional)
END_ARG
\`\`\``.trim();

  exampleDynamicToolCall = `
\`\`\`tool
TOOL_NAME: example_tool
BEGIN_ARG: arg_1
The value
of arg 1
END_ARG
BEGIN_ARG: arg_2
3
END_ARG
\`\`\``.trim();

  createSystemMessageExampleCall(
    toolName: string,
    prefix: string,
    exampleArgs: Array<[string, string | number]> = [],
  ) {
    let callExample = `\`\`\`tool
TOOL_NAME: ${toolName}`;

    // Add each argument dynamically
    for (const [argName, argValue] of exampleArgs) {
      callExample += `
BEGIN_ARG: ${argName}
${argValue}
END_ARG`;
    }

    callExample += `
\`\`\``;

    return `${prefix.trim()}
${callExample}`;
  }
}

export class CompactSystemMessageToolCodeblocksFramework extends SystemMessageToolCodeblocksFramework {
  enableImplicitShellCommandToolCalls = true;
  enableImplicitWorkspaceUnavailableToolCalls = true;
  enableImplicitUngroundedSourceToolCalls = false;
  implicitWorkspaceSearchQuery?: string;

  constructor(
    options: {
      enableImplicitWorkspaceUnavailableToolCalls?: boolean;
      enableImplicitUngroundedSourceToolCalls?: boolean;
      implicitWorkspaceSearchQuery?: string;
    } = {},
  ) {
    super();
    this.enableImplicitWorkspaceUnavailableToolCalls =
      options.enableImplicitWorkspaceUnavailableToolCalls ?? true;
    this.enableImplicitUngroundedSourceToolCalls =
      options.enableImplicitUngroundedSourceToolCalls ?? false;
    this.implicitWorkspaceSearchQuery = options.implicitWorkspaceSearchQuery;
  }

  toolOutputIntro =
    "Qivryn local tool result. This is real output from the user's workspace. Use it as evidence and do not ask the user to attach or paste the workspace.";

  systemMessagePrefix = `Qivryn runtime tool bridge. Behave as Qivryn's coding agent inside the user's current VS Code workspace. You can use the user's local workspace through the tools below. If workspace, file, terminal, skill, or context access is needed, call a listed tool instead of saying workspace or filesystem access is unavailable.

Do not ask the user to upload, paste, or share the repository, files, logs, project tree, or workspace path before a listed tool fails. Treat local tool results as real evidence and continue from them.

For root-cause, debugging, repository review, or code investigation requests, call a local tool first unless current code/log evidence is already enough.

Core coding tools when listed: grep_search finds symbols, errors, configs, and customer symptoms; ls and view_repo_map orient the workspace; read_file and read_file_range inspect the few relevant matches; run_terminal_command is for builds, tests, git, and shell-only diagnostics.

Tool calls MUST use exactly this fenced format:
\`\`\`tool
TOOL_NAME: tool_name
BEGIN_ARG: arg_name
value
END_ARG
\`\`\`

Raw JSON is not a tool call. Do not output JSON objects such as {"paths":["?"]} as a substitute for a tool call.`;

  systemMessageSuffix = `RULES FOR TOOL USE:
1. Use exactly one tool block when you need local workspace, file, terminal, skill, or context access.
2. Put no prose after a tool block.
3. For root-cause, debugging, repository review, or code investigation requests, make a tool call before analysis unless current conversation evidence already includes the required code/log output.
4. For repository or workspace review requests, start with one broad ls, grep_search, or view_repo_map only when no workspace listing, file target, or search term is already available.
5. For concrete identifiers, errors, classes, endpoints, config keys, or customer symptoms, prefer grep_search first, then read_file or read_file_range for the few matching files.
6. Prefer ls, grep_search, read_file, read_file_range, view_subdirectory, or view_repo_map for workspace inspection before terminal commands.
7. Use terminal commands for builds, tests, package scripts, git, and shell-only diagnostics.
8. Never call run_terminal_command with explanatory text. The command argument must contain only shell syntax.
9. If a terminal command is rejected as malformed, retry with a listed workspace/file/search tool; do not ask the user to paste the repo.
10. Do not write shell commands as plain text, such as bash -lc ls. Use a listed tool block instead.
11. Treat "Tool output for ..." messages as real local Qivryn tool results and continue from that evidence.
12. Do not repeat ls, grep_search, read_file, read_file_range, or other read-only tools with the same arguments after Qivryn returns a result. Use the earlier result and continue with the next targeted step.
13. Do not invent tools or arguments that are not listed.
14. Do not claim the workspace is unavailable until a listed workspace/file tool fails.`;

  exampleDynamicToolDefinition = `
\`\`\`tool_definition
TOOL_NAME: example_tool
TOOL_ARG: arg_1 (string, required)
END_ARG
\`\`\``.trim();

  exampleDynamicToolCall = `
\`\`\`tool
TOOL_NAME: example_tool
BEGIN_ARG: arg_1
value
END_ARG
\`\`\``.trim();

  toolToSystemToolDefinition(tool: Tool): string {
    const lines = ["```tool_definition", `TOOL_NAME: ${tool.function.name}`];

    const description = compactText(tool.function.description, 180);
    if (description) {
      lines.push(`TOOL_DESCRIPTION: ${description}`);
    }

    if (tool.function.parameters && "properties" in tool.function.parameters) {
      for (const [key, value] of Object.entries(
        tool.function.parameters.properties as object,
      )) {
        const isRequired = tool.function.parameters.required?.includes(key);
        const requiredText = isRequired ? "required" : "optional";
        const argType = getSchemaType(value);
        const argDescription = compactText(getSchemaDescription(value), 140);
        lines.push(
          `TOOL_ARG: ${key} (${argType}, ${requiredText})${argDescription ? ` - ${argDescription}` : ""}`,
        );
        lines.push("END_ARG");
      }
    }

    lines.push("```");
    return lines.join("\n");
  }

  createSystemMessageExampleCall(
    toolName: string,
    prefix: string,
    exampleArgs: Array<[string, string | number]> = [],
  ) {
    let callExample = `${compactText(prefix, 220)}
\`\`\`tool
TOOL_NAME: ${toolName}`;

    for (const [argName, argValue] of exampleArgs) {
      callExample += `
BEGIN_ARG: ${argName}
${argValue}
END_ARG`;
    }

    callExample += `
\`\`\``;

    return callExample;
  }
}
