import { ChatMessage, PromptLog, TextMessagePart, ToolCallDelta } from "../..";
import { normalizeToMessageParts } from "../../util/messageContent";
import { BuiltInToolNames } from "../builtIn";
import { detectToolCallStart } from "./detectToolCallStart";
import { createDelta, splitAtCodeblocksAndNewLines } from "./systemToolUtils";
import {
  getInitialToolCallParseState,
  SystemMessageToolsFramework,
  ToolCallParseState,
} from "./types";

type ImplicitToolCallDetection =
  | { status: "none" }
  | { status: "partial" }
  | {
      status: "tool";
      deltas: ToolCallDelta[];
      suppressRemainingAssistantText?: boolean;
    };

function createToolCallDeltas(
  toolName: BuiltInToolNames,
  args: Record<string, unknown>,
): ToolCallDelta[] {
  const { toolCallId } = getInitialToolCallParseState();
  const deltas = [createDelta(toolName, "", toolCallId)];
  const entries = Object.entries(args);

  for (const [index, [key, value]] of entries.entries()) {
    const prefix = index === 0 ? "{" : ",";
    deltas.push(
      createDelta("", `${prefix}${JSON.stringify(key)}:`, toolCallId),
    );
    deltas.push(createDelta("", JSON.stringify(value), toolCallId));
  }

  if (entries.length > 0) {
    deltas.push(createDelta("", "}", toolCallId));
  }

  return deltas;
}

function createImplicitLsDeltas(): ToolCallDelta[] {
  return createToolCallDeltas(BuiltInToolNames.LSTool, {
    dirPath: ".",
    recursive: false,
  });
}

export function createImplicitWorkspaceEvidenceDeltas(
  framework: Pick<SystemMessageToolsFramework, "implicitWorkspaceSearchQuery">,
): ToolCallDelta[] {
  const searchQuery = framework.implicitWorkspaceSearchQuery?.trim();
  if (searchQuery) {
    return createToolCallDeltas(BuiltInToolNames.GrepSearch, {
      query: searchQuery,
      output_mode: "files_with_matches",
      head_limit: 50,
      sort: "path",
    });
  }

  return createImplicitLsDeltas();
}

function isPossibleWorkspaceProbePrefix(value: string): boolean {
  const compact = value.toLowerCase().replace(/\s+/g, "");
  const target = '{"paths"';
  return (
    target.startsWith(compact) ||
    compact.startsWith('{"paths":') ||
    compact.startsWith('{"path":')
  );
}

function detectImplicitWorkspaceProbe(
  buffer: string,
  framework: SystemMessageToolsFramework,
  isFinal = false,
): ImplicitToolCallDetection {
  const trimmed = buffer.trim();
  if (!trimmed.startsWith("{")) {
    return { status: "none" };
  }

  if (!isPossibleWorkspaceProbePrefix(trimmed)) {
    return { status: "none" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).every((key) => key === "paths") &&
      Array.isArray((parsed as { paths?: unknown }).paths) &&
      (parsed as { paths: unknown[] }).paths.length > 0 &&
      (parsed as { paths: unknown[] }).paths.every(
        (path) => path === "?" || path === "." || path === "",
      )
    ) {
      return {
        status: "tool",
        deltas: createImplicitWorkspaceEvidenceDeltas(framework),
        suppressRemainingAssistantText: true,
      };
    }
  } catch {
    if (isFinal) {
      return { status: "none" };
    }
    return { status: "partial" };
  }

  return { status: "none" };
}

const WORKSPACE_UNAVAILABLE_MARKERS = [
  "workspace browsing tools",
  "attached project context",
  "attach the repository",
  "attach the repo",
  "paste the output of ls",
  "paste the project structure",
  "provide the repository path",
  "upload the repo",
  "upload the workspace",
  "cannot access the workspace",
  "can't access the workspace",
  "could not access the workspace",
  "could not identify a user repository",
  "could not identify a workspace",
  "don't have access to the workspace",
  "don't have access to workspace",
  "don't currently have access to any workspace",
  "don't currently have access to the workspace",
  "don't currently have access to workspace",
  "do not have access to the workspace",
  "do not have access to workspace",
  "do not currently have access to any workspace",
  "do not currently have access to the workspace",
  "do not currently have access to workspace",
  "don't have the repository files",
  "do not have the repository files",
  "repository files or runtime traces",
  "need the relevant code/log context",
  "need the relevant codebase/log context",
  "relevant code/log context from the workspace",
  "relevant codebase/log context from the workspace",
  "please provide:",
  "share the relevant files",
  "share the relevant files or logs",
  "share the relevant codebase",
] as const;

const WORKSPACE_UNAVAILABLE_PREFIXES = [
  "i can investigate",
  "i can help investigate",
  "i can help trace",
  "i can review a workspace",
  "i can review the workspace",
  "i can review a repository",
  "i can review the repository",
  "i checked the available environment",
  "i don't currently have access",
  "i do not currently have access",
  "i don't have access",
  "i do not have access",
  "i cannot access",
  "i can't access",
  "please either",
] as const;

function normalizeAssistantText(value: string): string {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function detectImplicitWorkspaceUnavailableResponse(
  buffer: string,
  framework: SystemMessageToolsFramework,
  isFinal = false,
): ImplicitToolCallDetection {
  const normalized = normalizeAssistantText(buffer);
  if (!normalized) {
    return { status: "none" };
  }

  if (
    WORKSPACE_UNAVAILABLE_MARKERS.some((marker) => normalized.includes(marker))
  ) {
    return {
      status: "tool",
      deltas: createImplicitWorkspaceEvidenceDeltas(framework),
      suppressRemainingAssistantText: true,
    };
  }

  const couldBecomeWorkspaceUnavailableResponse =
    WORKSPACE_UNAVAILABLE_PREFIXES.some(
      (prefix) =>
        prefix.startsWith(normalized) || normalized.startsWith(prefix),
    );
  if (
    couldBecomeWorkspaceUnavailableResponse &&
    !isFinal &&
    normalized.length < 2_500
  ) {
    return { status: "partial" };
  }

  return { status: "none" };
}

const UNGROUNDED_SOURCE_ANALYSIS_MARKERS = [
  "based on the information provided",
  "based on the details provided",
  "based on the findings",
  "based on the customer's test result",
  "the issue does not appear to be a configuration gap",
  "does not appear to be a configuration gap",
  "the documented setup suggests",
  "no additional linking screen",
  "no additional configuration step",
  "there is no documented customer-facing db table",
  "standard application logging/tracking should be used",
  "the key question is whether",
  "for dev escalation",
  "dev investigation would be justified",
  "a dev investigation would be justified",
  "a product defect exists",
] as const;

const UNGROUNDED_SOURCE_ANALYSIS_PREFIXES = [
  "based on",
  "given the customer",
  "given the provided",
  "the issue",
  "for dev",
] as const;

function detectImplicitUngroundedSourceAnalysisResponse(
  buffer: string,
  framework: SystemMessageToolsFramework,
  isFinal = false,
): ImplicitToolCallDetection {
  if (
    framework.enableImplicitUngroundedSourceToolCalls !== true ||
    !framework.implicitWorkspaceSearchQuery?.trim()
  ) {
    return { status: "none" };
  }

  const normalized = normalizeAssistantText(buffer);
  if (!normalized) {
    return { status: "none" };
  }

  if (
    UNGROUNDED_SOURCE_ANALYSIS_MARKERS.some((marker) =>
      normalized.includes(marker),
    )
  ) {
    return {
      status: "tool",
      deltas: createImplicitWorkspaceEvidenceDeltas(framework),
      suppressRemainingAssistantText: true,
    };
  }

  const couldBecomeUngroundedSourceAnalysis =
    UNGROUNDED_SOURCE_ANALYSIS_PREFIXES.some(
      (prefix) =>
        prefix.startsWith(normalized) || normalized.startsWith(prefix),
    );
  if (
    couldBecomeUngroundedSourceAnalysis &&
    !isFinal &&
    normalized.length < 1_200
  ) {
    return { status: "partial" };
  }

  return { status: "none" };
}

const SHELL_COMMAND_PREFIXES = [
  "$",
  "bash",
  "zsh",
  "sh",
  "ls",
  "pwd",
  "find",
  "rg",
  "grep",
  "cat",
  "sed",
  "git",
  "npm",
  "pnpm",
  "yarn",
  "node",
  "python",
  "python3",
  "pytest",
  "vitest",
  "tsc",
] as const;

function isPossibleShellCommandPrefix(value: string): boolean {
  const lower = value.trimStart().toLowerCase();
  if (!lower) {
    return false;
  }

  return SHELL_COMMAND_PREFIXES.some((prefix) => {
    return (
      prefix.startsWith(lower) ||
      lower === prefix ||
      lower.startsWith(`${prefix} `) ||
      lower.startsWith(`${prefix}\t`)
    );
  });
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === "'" || first === '"') && first === last
    ? trimmed.slice(1, -1)
    : trimmed;
}

function shellWords(value: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote || escaped) {
    return undefined;
  }
  if (current) {
    words.push(current);
  }

  return words;
}

function extractShellCommand(firstLine: string): string | undefined {
  const withoutPrompt = firstLine.replace(/^\$\s*/, "").trim();
  if (!withoutPrompt) {
    return undefined;
  }

  const wrapped = withoutPrompt.match(/^(?:bash|zsh|sh)\s+-[a-z]*c\s+(.+)$/i);
  if (wrapped) {
    return stripMatchingQuotes(wrapped[1]);
  }

  const commandName = withoutPrompt.match(/^([a-z0-9_./-]+)/i)?.[1];
  if (
    commandName &&
    SHELL_COMMAND_PREFIXES.includes(commandName.toLowerCase() as any) &&
    commandName !== "$" &&
    !["bash", "zsh", "sh"].includes(commandName.toLowerCase())
  ) {
    return withoutPrompt;
  }

  return undefined;
}

function hasShellControlOperator(value: string): boolean {
  return /(?:\|\||&&|[|;<>`])/.test(value);
}

function parsePlainLsCommand(
  command: string,
): Record<string, unknown> | undefined {
  if (hasShellControlOperator(command)) {
    return undefined;
  }

  const words = shellWords(command);
  if (!words || words[0] !== "ls") {
    return undefined;
  }

  let dirPath = ".";
  let recursive = false;
  for (const word of words.slice(1)) {
    if (word.startsWith("-")) {
      recursive ||= word.includes("R");
      continue;
    }
    dirPath = word;
    break;
  }

  return { dirPath, recursive };
}

function parsePlainCatCommand(
  command: string,
): Record<string, unknown> | undefined {
  if (hasShellControlOperator(command)) {
    return undefined;
  }

  const words = shellWords(command);
  if (!words || words.length !== 2 || words[0] !== "cat") {
    return undefined;
  }

  return { filepath: words[1] };
}

function detectImplicitShellCommand(
  buffer: string,
  isFinal = false,
): ImplicitToolCallDetection {
  const trimmedStart = buffer.trimStart();
  if (!trimmedStart) {
    return { status: "none" };
  }
  if (!isPossibleShellCommandPrefix(trimmedStart)) {
    return { status: "none" };
  }

  const newlineIndex = trimmedStart.indexOf("\n");
  const hasLineTerminator = newlineIndex >= 0;
  const firstLine = (
    hasLineTerminator ? trimmedStart.slice(0, newlineIndex) : trimmedStart
  ).trim();

  if (!firstLine) {
    return { status: "partial" };
  }

  const command = extractShellCommand(firstLine);
  if (!command) {
    return hasLineTerminator || isFinal
      ? { status: "none" }
      : { status: "partial" };
  }

  if (!hasLineTerminator && !isFinal) {
    return { status: "partial" };
  }

  const lsArgs = parsePlainLsCommand(command);
  if (lsArgs) {
    return {
      status: "tool",
      deltas: createToolCallDeltas(BuiltInToolNames.LSTool, lsArgs),
      suppressRemainingAssistantText: true,
    };
  }

  const readFileArgs = parsePlainCatCommand(command);
  if (readFileArgs) {
    return {
      status: "tool",
      deltas: createToolCallDeltas(BuiltInToolNames.ReadFile, readFileArgs),
      suppressRemainingAssistantText: true,
    };
  }

  return {
    status: "tool",
    deltas: createToolCallDeltas(BuiltInToolNames.RunTerminalCommand, {
      command,
      waitForCompletion: true,
    }),
    suppressRemainingAssistantText: true,
  };
}

function detectImplicitToolCall(
  buffer: string,
  framework: SystemMessageToolsFramework,
  isFinal = false,
): ImplicitToolCallDetection {
  if (framework.enableImplicitWorkspaceUnavailableToolCalls !== false) {
    const workspaceProbe = detectImplicitWorkspaceProbe(
      buffer,
      framework,
      isFinal,
    );
    if (workspaceProbe.status !== "none") {
      return workspaceProbe;
    }

    const workspaceUnavailable = detectImplicitWorkspaceUnavailableResponse(
      buffer,
      framework,
      isFinal,
    );
    if (workspaceUnavailable.status !== "none") {
      return workspaceUnavailable;
    }
  }

  const ungroundedSourceAnalysis =
    detectImplicitUngroundedSourceAnalysisResponse(buffer, framework, isFinal);
  if (ungroundedSourceAnalysis.status !== "none") {
    return ungroundedSourceAnalysis;
  }

  if (framework.enableImplicitShellCommandToolCalls) {
    return detectImplicitShellCommand(buffer, isFinal);
  }

  return { status: "none" };
}

/*
    Function to intercept tool calls in markdown code blocks format from a chat message stream
    1. Skips non-assistant messages
    2. Intercepts text that looks like a tool call in a markdown code block format:
    ```tool
    TOOL_NAME: example_tool
    BEGIN_ARG: arg1
    value
    END_ARG
    ```
    3. Parses tool calls line by line and generates proper tool call deltas
    4. Once the tool call is complete, resets state for potential future tool calls
*/
export async function* interceptSystemToolCalls(
  messageGenerator: AsyncGenerator<ChatMessage[], PromptLog | undefined>,
  abortController: AbortController,
  systemToolFramework: SystemMessageToolsFramework,
): AsyncGenerator<ChatMessage[], PromptLog | undefined> {
  let buffer = "";
  let parseState: ToolCallParseState | undefined;
  let bufferedAssistantMessage: ChatMessage | undefined;
  let suppressAssistantTextAfterImplicitTool = false;

  while (true) {
    const result = await messageGenerator.next();
    if (result.done) {
      if (
        buffer &&
        !parseState &&
        !suppressAssistantTextAfterImplicitTool &&
        bufferedAssistantMessage?.role === "assistant"
      ) {
        const implicitToolCall = detectImplicitToolCall(
          buffer,
          systemToolFramework,
          true,
        );
        if (implicitToolCall.status === "tool") {
          for (const delta of implicitToolCall.deltas) {
            yield [
              {
                ...bufferedAssistantMessage,
                content: "",
                toolCalls: [delta],
              },
            ];
          }
        } else {
          yield [
            {
              ...bufferedAssistantMessage,
              content: [{ type: "text", text: buffer }],
            },
          ];
        }
      }

      // Case: non-standard tool termination causes hanging args
      if (parseState && !parseState.done && parseState.processedArgNames.size) {
        yield [
          {
            role: "assistant",
            content: "",
            toolCalls: [createDelta("", "}", parseState.toolCallId)],
          },
        ];
      }

      return result.value;
    } else {
      for await (const message of result.value) {
        if (abortController.signal.aborted) {
          break;
        }
        // Skip non-assistant messages or messages with native tool calls
        if (message.role !== "assistant" || message.toolCalls) {
          yield [message];
          continue;
        }

        const parts = normalizeToMessageParts(message);

        // Image output cannot be combined with tools
        if (parts.find((part) => part.type === "imageUrl")) {
          yield [message];
          continue;
        }

        const chunks = (parts as TextMessagePart[])
          .map((part) => splitAtCodeblocksAndNewLines(part.text))
          .flat();

        for (const chunk of chunks) {
          if (suppressAssistantTextAfterImplicitTool) {
            continue;
          }

          buffer += chunk;
          bufferedAssistantMessage = message;
          if (!parseState) {
            const implicitToolCall = detectImplicitToolCall(
              buffer,
              systemToolFramework,
            );
            if (implicitToolCall.status === "partial") {
              continue;
            }
            if (implicitToolCall.status === "tool") {
              for (const delta of implicitToolCall.deltas) {
                yield [
                  {
                    ...message,
                    content: "",
                    toolCalls: [delta],
                  },
                ];
              }
              suppressAssistantTextAfterImplicitTool =
                implicitToolCall.suppressRemainingAssistantText === true;
              buffer = "";
              continue;
            }

            const { isInPartialStart, isInToolCall, modifiedBuffer } =
              detectToolCallStart(buffer, systemToolFramework);

            if (isInPartialStart) {
              continue;
            }
            if (isInToolCall) {
              parseState = getInitialToolCallParseState();
              buffer = modifiedBuffer;
            }
          }

          if (parseState && !parseState.done) {
            const delta = systemToolFramework.handleToolCallBuffer(
              buffer,
              parseState,
            );
            if (delta) {
              yield [
                {
                  ...message,
                  content: "",
                  toolCalls: [delta],
                },
              ];
            }
            // Completed tool calls should not terminate parsing for subsequent
            // chunks/messages; reset state so normal content (or another tool
            // call) can be handled.
            if (parseState.done) {
              parseState = undefined;
            }
          } else {
            // Yield normal assistant message
            yield [
              {
                ...message,
                content: [{ type: "text", text: buffer }],
              },
            ];
          }
          buffer = "";
        }
      }
    }
  }
}
