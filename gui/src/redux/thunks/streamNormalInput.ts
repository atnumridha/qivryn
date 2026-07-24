import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import {
  ChatMessage,
  ChatHistoryItem,
  LLMFullCompletionOptions,
  ModelDescription,
  PromptLog,
  ToolCallDelta,
  ToolCallState,
} from "core";
import { getRuleId } from "core/llm/rules/getSystemMessageWithRules";
import { ToCoreProtocol } from "core/protocol";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "core/tools/builtIn";
import { MALFORMED_TERMINAL_COMMAND_MESSAGE } from "core/tools/constants";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  acceptToolCall,
  abortStream,
  addPromptCompletionPair,
  errorToolCall,
  setActive,
  setAppliedRulesAtIndex,
  setContextPercentage,
  setContextUsage,
  setCompactionLoading,
  setInactive,
  setInlineErrorMessage,
  setIsPruned,
  setToolGenerated,
  streamUpdate,
  updateHistoryItemAtIndex,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { constructMessages } from "../util/constructMessages";
import {
  GUI_AUTO_COMPACTION_THRESHOLD,
  getAutoCompactionTarget,
} from "../../util/autoCompaction";
import { createStreamUpdateBatcher } from "../../util/streamUpdateBatcher";

import { modelSupportsNativeTools } from "core/llm/toolSupport";
import { applyToolOverrides } from "core/tools/applyToolOverrides";
import { compactToolsForPrompt } from "core/tools/compactToolsForPrompt";
import { addSystemMessageToolsToSystemMessage } from "core/tools/systemMessageTools/buildToolsSystemMessage";
import {
  createImplicitWorkspaceEvidenceDeltas,
  interceptSystemToolCalls,
} from "core/tools/systemMessageTools/interceptSystemToolCalls";
import {
  CompactSystemMessageToolCodeblocksFramework,
  SystemMessageToolCodeblocksFramework,
} from "core/tools/systemMessageTools/toolCodeblocks";

import {
  selectCurrentToolCalls,
  selectPendingToolCalls,
} from "../selectors/selectToolCalls";
import { getBaseSystemMessage } from "../util/getBaseSystemMessage";
import { callToolById } from "./callToolById";
import { evaluateToolPolicies } from "./evaluateToolPolicies";
import { preprocessToolCalls } from "./preprocessToolCallArgs";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

const MAX_GUI_AUTO_COMPACTION_ATTEMPTS = 3;
const DUPLICATE_READONLY_TOOL_CALL_SKIPPED_MARKER =
  "Qivryn skipped this repeated readonly tool call.";
const CHATGPT_NATIVE_TOOL_AGENT_INSTRUCTIONS =
  "ChatGPT/Codex backend note: the listed Qivryn tools are real local VS Code workspace tools. For code, root-cause, debugging, repository review, or follow-up investigation, call the smallest useful local tool first instead of asking the user to attach files or saying workspace access is unavailable. Prefer one targeted grep/read over repeated broad listings, then continue from tool evidence.";

function withChatGPTNativeToolInstructions(
  message: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!enabled || !message) {
    return message;
  }

  if (message.includes(CHATGPT_NATIVE_TOOL_AGENT_INSTRUCTIONS)) {
    return message;
  }

  return `${message}\n\n${CHATGPT_NATIVE_TOOL_AGENT_INSTRUCTIONS}`;
}

async function* syntheticToolCallStream(
  toolDeltas: ToolCallDelta[],
): AsyncGenerator<ChatMessage[], PromptLog | undefined> {
  for (const delta of toolDeltas) {
    yield [
      {
        role: "assistant",
        content: "",
        toolCalls: [delta],
      },
    ];
  }
  return undefined;
}

function areCurrentToolCallsComplete(
  toolCalls: Array<{ status: string }>,
  qivrynAfterToolRejection: boolean | undefined,
): boolean {
  return (
    toolCalls.length > 0 &&
    toolCalls.every(
      (tc) =>
        tc.status === "done" ||
        tc.status === "errored" ||
        (qivrynAfterToolRejection && tc.status === "canceled"),
    )
  );
}

/**
 * Builds completion options with reasoning configuration based on session state and model capabilities.
 *
 * @param baseOptions - Base completion options to extend
 * @param hasReasoningEnabled - Whether reasoning is enabled in the session
 * @param model - The selected model with provider and completion options
 * @returns Completion options with reasoning configuration
 */
function buildReasoningCompletionOptions(
  baseOptions: LLMFullCompletionOptions,
  hasReasoningEnabled: boolean | undefined,
  model: ModelDescription,
): LLMFullCompletionOptions {
  if (hasReasoningEnabled === undefined) {
    return baseOptions;
  }

  const reasoningOptions: LLMFullCompletionOptions = {
    ...baseOptions,
    reasoning: !!hasReasoningEnabled,
  };

  // Add reasoning budget tokens if reasoning is enabled and provider supports it
  if (hasReasoningEnabled && model.underlyingProviderName !== "ollama") {
    // Ollama doesn't support limiting reasoning tokens at this point
    reasoningOptions.reasoningBudgetTokens =
      model.completionOptions?.reasoningBudgetTokens ?? 2048;
  }

  return reasoningOptions;
}

function latestUserMessageIndex(history: ChatHistoryItem[]): number {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].message.role === "user") {
      return index;
    }
  }
  return -1;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const IMPLICIT_WORKSPACE_SEARCH_STOPWORDS = new Set([
  "about",
  "actual",
  "added",
  "after",
  "also",
  "and",
  "are",
  "below",
  "can",
  "check",
  "code",
  "codebase",
  "configured",
  "customer",
  "details",
  "does",
  "done",
  "external",
  "files",
  "find",
  "for",
  "from",
  "has",
  "have",
  "here",
  "issue",
  "need",
  "not",
  "observed",
  "or",
  "path",
  "please",
  "received",
  "request",
  "response",
  "root",
  "service",
  "share",
  "should",
  "summary",
  "the",
  "this",
  "use",
  "validation",
  "when",
  "with",
  "working",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreImplicitWorkspaceSearchTerm(term: string): number {
  let score = term.length;
  if (/[./_-]/.test(term)) {
    score += 60;
  }
  if (/[a-z]/.test(term) && /[A-Z]/.test(term)) {
    score += 50;
  }
  if (/(Service|Result|Status|Order|Adjustment|Validation)$/i.test(term)) {
    score += 30;
  }
  if (/^[A-Z0-9_]+$/.test(term) && term.length > 4) {
    score += 20;
  }
  return score;
}

function deriveImplicitWorkspaceSearchQuery(
  history: ChatHistoryItem[],
): string | undefined {
  const userIndex = latestUserMessageIndex(history);
  if (userIndex < 0) {
    return undefined;
  }

  const texts: string[] = [];
  for (let index = userIndex; index >= 0 && texts.length < 3; index--) {
    const item = history[index];
    if (item.message.role !== "user") {
      continue;
    }
    const text = textFromMessageContent(item.message.content).trim();
    if (!text) {
      continue;
    }
    texts.push(text);
    if (text.length > 300) {
      break;
    }
  }

  const text = texts.reverse().join("\n");
  const matches = text.match(/[A-Za-z][A-Za-z0-9_./-]{3,}/g) ?? [];
  const candidates = new Map<string, string>();

  for (const raw of matches) {
    const term = raw.replace(/^[-./_]+|[-./_]+$/g, "");
    const lower = term.toLowerCase();
    if (
      term.length < 4 ||
      lower.startsWith("http") ||
      lower.includes(".com/") ||
      lower.includes("oraclecorp.com") ||
      IMPLICIT_WORKSPACE_SEARCH_STOPWORDS.has(lower)
    ) {
      continue;
    }
    if (!candidates.has(lower)) {
      candidates.set(lower, term);
    }
  }

  const scoredTerms = Array.from(candidates.values())
    .map((term) => ({
      term,
      score: scoreImplicitWorkspaceSearchTerm(term),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.term.localeCompare(right.term),
    );

  const topScore = scoredTerms[0]?.score ?? 0;
  const minimumScore = Math.max(50, topScore - 35);
  const terms = scoredTerms
    .filter(({ score }) => score >= minimumScore)
    .slice(0, 6)
    .map(({ term }) => term);

  if (terms.length === 0) {
    return undefined;
  }

  return terms.map(escapeRegExp).join("|");
}

function isMalformedTerminalToolCallState(
  toolCallState: ToolCallState,
): boolean {
  return (
    toolCallState.toolCall.function.name ===
      BuiltInToolNames.RunTerminalCommand &&
    toolCallState.output?.some((item) =>
      item.content.includes(MALFORMED_TERMINAL_COMMAND_MESSAGE),
    ) === true
  );
}

function hasUsefulToolActivityAfterIndex(
  history: ChatHistoryItem[],
  index: number,
): boolean {
  return history.slice(index + 1).some((item) => {
    const hasToolCallStates = (item.toolCallStates?.length ?? 0) > 0;
    const usefulToolCallStates = (item.toolCallStates ?? []).filter(
      (toolCallState) => !isMalformedTerminalToolCallState(toolCallState),
    );
    const isMalformedTerminalToolMessage =
      item.message.role === "tool" &&
      typeof item.message.content === "string" &&
      item.message.content.includes(MALFORMED_TERMINAL_COMMAND_MESSAGE);
    return (
      (item.message.role === "tool" && !isMalformedTerminalToolMessage) ||
      usefulToolCallStates.length > 0 ||
      (item.message.role === "assistant" &&
        !hasToolCallStates &&
        (item.message.toolCalls?.length ?? 0) > 0)
    );
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parsedToolArgs(toolCallState: ToolCallState): unknown {
  if (toolCallState.parsedArgs !== undefined) {
    return toolCallState.parsedArgs;
  }

  try {
    return JSON.parse(toolCallState.toolCall.function.arguments || "{}");
  } catch {
    return undefined;
  }
}

function normalizeToolArgsForSignature(
  toolName: string,
  args: unknown,
): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args ?? {};
  }

  const normalized: Record<string, unknown> = { ...args };
  if (toolName === "ls") {
    if (normalized.dirPath === undefined || normalized.dirPath === "") {
      normalized.dirPath = ".";
    }
    if (normalized.recursive === undefined) {
      normalized.recursive = false;
    }
  }

  return normalized;
}

function toolCallSignature(toolCallState: ToolCallState): string | undefined {
  const toolName = toolCallState.toolCall.function.name;
  if (!toolName) {
    return undefined;
  }

  return `${toolName}:${stableStringify(
    normalizeToolArgsForSignature(toolName, parsedToolArgs(toolCallState)),
  )}`;
}

function hasSkippedDuplicateOutput(toolCallState: ToolCallState): boolean {
  return (
    toolCallState.output?.some((item) =>
      item.content.includes(DUPLICATE_READONLY_TOOL_CALL_SKIPPED_MARKER),
    ) ?? false
  );
}

function findPriorCompletedReadonlyToolCall(
  history: ChatHistoryItem[],
  toolCallState: ToolCallState,
):
  | {
      duplicateWasAlreadySkipped: boolean;
    }
  | undefined {
  const currentSignature = toolCallSignature(toolCallState);
  if (!currentSignature || toolCallState.tool?.readonly !== true) {
    return undefined;
  }

  const latestUserIndex = latestUserMessageIndex(history);
  if (latestUserIndex < 0) {
    return undefined;
  }

  let duplicateFound = false;
  let duplicateWasAlreadySkipped = false;
  for (const item of history.slice(latestUserIndex + 1)) {
    for (const candidate of item.toolCallStates ?? []) {
      if (candidate.toolCallId === toolCallState.toolCallId) {
        continue;
      }
      if (candidate.status !== "done" || candidate.tool?.readonly === false) {
        continue;
      }
      if (toolCallSignature(candidate) !== currentSignature) {
        continue;
      }

      duplicateFound = true;
      duplicateWasAlreadySkipped ||= hasSkippedDuplicateOutput(candidate);
    }
  }

  return duplicateFound ? { duplicateWasAlreadySkipped } : undefined;
}

function skipDuplicateReadonlyToolCalls(
  dispatch: ReturnType<typeof createSessionScopedDispatch>,
  history: ChatHistoryItem[],
  toolCallStates: ToolCallState[],
): { skippedToolCallIds: string[]; shouldContinue: boolean } {
  const skippedToolCallIds: string[] = [];
  let duplicateWasAlreadySkipped = false;

  for (const toolCallState of toolCallStates) {
    const duplicate = findPriorCompletedReadonlyToolCall(
      history,
      toolCallState,
    );
    if (!duplicate) {
      continue;
    }

    skippedToolCallIds.push(toolCallState.toolCallId);
    duplicateWasAlreadySkipped ||= duplicate.duplicateWasAlreadySkipped;
    const toolName = toolCallState.toolCall.function.name;
    dispatch(
      updateToolCallOutput({
        toolCallId: toolCallState.toolCallId,
        contextItems: [
          {
            name: "Duplicate tool call skipped",
            description: `${toolName} already ran with the same arguments`,
            content: `${DUPLICATE_READONLY_TOOL_CALL_SKIPPED_MARKER} The same ${toolName} call already completed in this turn. Use the earlier tool output already present in the conversation and continue with the next targeted step.`,
            hidden: false,
          },
        ],
      }),
    );
    dispatch(acceptToolCall({ toolCallId: toolCallState.toolCallId }));
  }

  return {
    skippedToolCallIds,
    shouldContinue: !duplicateWasAlreadySkipped,
  };
}

function isReadonlyBuiltInToolCall(
  activeTools: ReturnType<typeof selectActiveTools>,
  toolCallState: ToolCallState,
): boolean {
  const tool = activeTools.find(
    (candidate) =>
      candidate.function.name === toolCallState.toolCall.function.name,
  );
  return tool?.readonly === true && tool.group === BUILT_IN_GROUP_NAME;
}

function isChatGPTPayloadTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:\b413\b|Payload Too Large|message_length_exceeds_limit|messages you submitted were too long)/i.test(
    message,
  );
}

export const streamNormalInput = createAsyncThunk<
  void,
  {
    legacySlashCommandData?: ToCoreProtocol["llm/streamChat"][0]["legacySlashCommandData"];
    depth?: number;
    autoCompactAttempts?: number;
    sessionId?: string;
  },
  ThunkApiType
>(
  "chat/streamNormalInput",
  async (
    {
      legacySlashCommandData,
      depth = 0,
      autoCompactAttempts = 0,
      sessionId: requestedSessionId,
    },
    { dispatch, extra, getState },
  ) => {
    const sessionId = requestedSessionId ?? getState().session.id;
    const getScopedState = () => getRootStateForSession(getState(), sessionId);
    const scopedDispatch = createSessionScopedDispatch(
      dispatch,
      sessionId,
      getState,
    );

    if (process.env.NODE_ENV === "test" && depth > 50) {
      const message = `Max stream depth of ${50} reached in test`;
      console.error(message, JSON.stringify(getScopedState(), null, 2));
      throw new Error(message);
    }
    let state = getScopedState();
    const selectedChatModel =
      state.config.config?.modelsByRole?.chat?.find(
        (model) => model.title === state.session.chatModelTitle,
      ) ?? selectSelectedChatModel(state);

    if (!selectedChatModel) {
      throw new Error("No chat model selected");
    }

    const compactAutomatically = async (
      compactionTarget: number | undefined,
    ): Promise<boolean> => {
      if (compactionTarget === undefined) {
        return false;
      }

      if (!sessionId) {
        return false;
      }

      scopedDispatch(
        setCompactionLoading({ index: compactionTarget, loading: true }),
      );
      try {
        const compacted = await extra.ideMessenger.request(
          "conversation/compact",
          {
            index: compactionTarget,
            sessionId,
            automatic: true,
          },
        );
        if (compacted?.status === "success" && compacted.content) {
          scopedDispatch(
            updateHistoryItemAtIndex({
              index: compactionTarget,
              updates: {
                conversationSummary: compacted.content,
                conversationSummaryAutomatic: true,
              },
            }),
          );
          state = getScopedState();
          return true;
        } else if (compacted?.status === "error") {
          console.warn("Automatic context compaction failed", compacted.error);
        }
      } catch (error) {
        // Compaction is an optimization. Preserve the user's prompt and let the
        // existing pruning/error path handle providers that cannot summarize.
        console.warn("Automatic context compaction failed", error);
      } finally {
        scopedDispatch(
          setCompactionLoading({ index: compactionTarget, loading: false }),
        );
      }
      return false;
    };

    await compactAutomatically(
      getAutoCompactionTarget(
        state.session.history,
        state.session.contextPercentage,
        state.session.isPruned,
      ),
    );

    // Get tools and apply model-level overrides (disabled, description, etc.)
    let activeTools = selectActiveTools(state);
    if (selectedChatModel.toolOverrides?.length) {
      const { tools: overriddenTools, errors } = applyToolOverrides(
        activeTools,
        selectedChatModel.toolOverrides,
      );
      activeTools = overriddenTools;
      for (const error of errors) {
        if (!error.fatal) {
          console.warn(`Tool override warning: ${error.message}`);
        }
      }
    }
    const promptTools = compactToolsForPrompt(activeTools) ?? [];

    const isChatGPTCodexModel =
      selectedChatModel.provider === "chatgpt-codex" ||
      selectedChatModel.underlyingProviderName === "chatgpt-codex";
    const selectedChatGPTBackendMode = isChatGPTCodexModel
      ? (state.ui.chatGPTBackendModeSettings?.[selectedChatModel.title ?? ""] ??
        (selectedChatModel as any).chatgptBackendMode ??
        "codex")
      : undefined;
    const isChatGPTEndpointSelected = selectedChatGPTBackendMode === "chatgpt";
    const currentUserIndex = latestUserMessageIndex(state.session.history);
    const latestUserAlreadyHasToolActivity =
      currentUserIndex >= 0 &&
      hasUsefulToolActivityAfterIndex(state.session.history, currentUserIndex);
    const implicitWorkspaceSearchQuery =
      isChatGPTEndpointSelected &&
      activeTools.some(
        (tool) => tool.function.name === BuiltInToolNames.GrepSearch,
      )
        ? deriveImplicitWorkspaceSearchQuery(state.session.history)
        : undefined;

    const modelCanUseNativeTools = modelSupportsNativeTools(selectedChatModel);
    const hasPromptTools = promptTools.length > 0;

    // Keep real tool schemas for ChatGPT/Codex agent turns. The ChatGPT adapter
    // proxies those tool-capable requests through the Codex-compatible
    // Responses route, matching the CodieBaseApp behavior. Plain chat turns can
    // still use the selected ChatGPT conversation endpoint.
    const forceSystemMessageTools =
      hasPromptTools &&
      (state.config.config.experimental?.onlyUseSystemMessageTools === true ||
        (isChatGPTCodexModel && !modelCanUseNativeTools));
    const useNativeTools = forceSystemMessageTools
      ? false
      : hasPromptTools && modelCanUseNativeTools;
    const chatGPTToolRecoveryFramework =
      isChatGPTCodexModel && hasPromptTools
        ? new CompactSystemMessageToolCodeblocksFramework({
            enableImplicitWorkspaceUnavailableToolCalls: true,
            enableImplicitUngroundedSourceToolCalls:
              isChatGPTEndpointSelected &&
              !!implicitWorkspaceSearchQuery &&
              !latestUserAlreadyHasToolActivity,
            implicitWorkspaceSearchQuery,
          })
        : undefined;
    const systemToolsFramework =
      hasPromptTools && !useNativeTools
        ? (chatGPTToolRecoveryFramework ??
          new SystemMessageToolCodeblocksFramework())
        : undefined;
    const toolCallRecoveryFramework =
      systemToolsFramework ?? chatGPTToolRecoveryFramework;

    // Construct completion options
    let completionOptions: LLMFullCompletionOptions = {};
    if (useNativeTools && promptTools.length > 0) {
      completionOptions = {
        tools: promptTools,
      };
    }
    const effectiveChatGPTBackendMode =
      selectedChatGPTBackendMode &&
      isChatGPTCodexModel &&
      useNativeTools &&
      hasPromptTools
        ? "codex"
        : selectedChatGPTBackendMode;
    if (effectiveChatGPTBackendMode) {
      completionOptions = {
        ...completionOptions,
        chatgptBackendMode: effectiveChatGPTBackendMode,
      };
    }

    completionOptions = buildReasoningCompletionOptions(
      completionOptions,
      state.session.hasReasoningEnabled,
      selectedChatModel,
    );

    // Inject reasoningEffort from UI selection (overrides the model's config default)
    const selectedReasoningEffort =
      state.ui.reasoningEffortSettings?.[selectedChatModel.title ?? ""];
    if (selectedReasoningEffort) {
      completionOptions = {
        ...completionOptions,
        reasoningEffort: selectedReasoningEffort,
      };
    }

    // Construct messages (excluding system message)
    const baseSystemMessage = getBaseSystemMessage(
      state.session.mode,
      selectedChatModel,
      promptTools,
    );

    const systemMessageWithOptionalSystemTools = systemToolsFramework
      ? addSystemMessageToolsToSystemMessage(
          systemToolsFramework,
          baseSystemMessage,
          promptTools,
        )
      : baseSystemMessage;
    const systemMessage = withChatGPTNativeToolInstructions(
      systemMessageWithOptionalSystemTools,
      isChatGPTEndpointSelected && useNativeTools && hasPromptTools,
    );

    const withoutMessageIds = state.session.history.map((item) => {
      const { id, ...messageWithoutId } = item.message;
      return { ...item, message: messageWithoutId };
    });

    const { messages, appliedRules, appliedRuleIndex } = constructMessages(
      withoutMessageIds,
      systemMessage,
      state.config.config.rules,
      state.ui.ruleSettings,
      systemToolsFramework,
    );

    // TODO parallel tool calls will cause issues with this
    // because there will be multiple tool messages, so which one should have applied rules?
    scopedDispatch(
      setAppliedRulesAtIndex({
        index: appliedRuleIndex,
        appliedRules: appliedRules,
      }),
    );

    scopedDispatch(setActive());
    scopedDispatch(setInlineErrorMessage(undefined));

    const shouldStartWithImplicitWorkspaceSearch =
      isChatGPTEndpointSelected &&
      !!implicitWorkspaceSearchQuery &&
      !latestUserAlreadyHasToolActivity &&
      activeTools.some(
        (tool) => tool.function.name === BuiltInToolNames.GrepSearch,
      );

    let compiledChatMessages: ChatMessage[] = [];
    if (!shouldStartWithImplicitWorkspaceSearch) {
      const precompiledRes = await extra.ideMessenger.request(
        "llm/compileChat",
        {
          messages,
          options: completionOptions,
        },
      );

      if (precompiledRes.status === "error") {
        if (precompiledRes.error.includes("Not enough context")) {
          const didCompact =
            autoCompactAttempts < MAX_GUI_AUTO_COMPACTION_ATTEMPTS &&
            (await compactAutomatically(
              getAutoCompactionTarget(
                getScopedState().session.history,
                1,
                true,
              ),
            ));
          if (didCompact) {
            unwrapResult(
              await dispatch(
                streamNormalInput({
                  sessionId,
                  legacySlashCommandData,
                  depth: depth + 1,
                  autoCompactAttempts: autoCompactAttempts + 1,
                }),
              ),
            );
            return;
          }

          scopedDispatch(setInlineErrorMessage("out-of-context"));
          scopedDispatch(setInactive());
          return;
        } else {
          throw new Error(precompiledRes.error);
        }
      }

      const {
        didPrune,
        contextPercentage,
        inputTokens,
        contextLength,
        availableTokens,
      } = precompiledRes.content;
      compiledChatMessages = precompiledRes.content.compiledChatMessages;

      scopedDispatch(setIsPruned(didPrune));
      scopedDispatch(setContextPercentage(contextPercentage));
      const configuredContextLength = selectedChatModel.contextLength ?? 32_768;
      scopedDispatch(
        setContextUsage({
          inputTokens:
            inputTokens ??
            Math.round(contextPercentage * configuredContextLength),
          contextLength: contextLength ?? configuredContextLength,
          availableTokens,
          model: selectedChatModel.model,
        }),
      );

      if (
        autoCompactAttempts < MAX_GUI_AUTO_COMPACTION_ATTEMPTS &&
        (didPrune || contextPercentage >= GUI_AUTO_COMPACTION_THRESHOLD)
      ) {
        const didCompact = await compactAutomatically(
          getAutoCompactionTarget(
            getScopedState().session.history,
            contextPercentage,
            didPrune,
          ),
        );
        if (didCompact) {
          unwrapResult(
            await dispatch(
              streamNormalInput({
                sessionId,
                legacySlashCommandData,
                depth: depth + 1,
                autoCompactAttempts: autoCompactAttempts + 1,
              }),
            ),
          );
          return;
        }
      }
    }

    const start = Date.now();
    const streamAborter = state.session.streamAborter;
    const toolCallIdsBeforeStream = new Set(
      selectCurrentToolCalls(getScopedState()).map(
        ({ toolCallId }) => toolCallId,
      ),
    );
    try {
      let gen: AsyncGenerator<ChatMessage[], PromptLog | undefined>;
      if (shouldStartWithImplicitWorkspaceSearch) {
        gen = syntheticToolCallStream(
          createImplicitWorkspaceEvidenceDeltas({
            implicitWorkspaceSearchQuery,
          }),
        );
      } else {
        gen = extra.ideMessenger.llmStreamChat(
          {
            completionOptions,
            title: selectedChatModel.title,
            messages: compiledChatMessages,
            legacySlashCommandData,
            messageOptions: { precompiled: true },
          },
          streamAborter.signal,
        );
        if (toolCallRecoveryFramework && activeTools.length > 0) {
          gen = interceptSystemToolCalls(
            gen,
            streamAborter,
            toolCallRecoveryFramework,
          );
        }
      }

      const isCurrentStream = () =>
        getScopedState().session.streamAborter === streamAborter &&
        !streamAborter.signal.aborted;
      const streamUpdates = createStreamUpdateBatcher((messages) => {
        if (isCurrentStream()) {
          scopedDispatch(streamUpdate(messages));
        }
      });

      let next = await gen.next();
      try {
        while (!next.done) {
          if (!getScopedState().session.isStreaming) {
            if (isCurrentStream()) {
              streamUpdates.flush();
              scopedDispatch(abortStream());
            } else {
              streamUpdates.cancel();
            }
            break;
          }
          if (!isCurrentStream()) {
            streamUpdates.cancel();
            break;
          }

          streamUpdates.enqueue(next.value);
          next = await gen.next();
        }
      } finally {
        // Make final text and tool-call deltas visible before completion logic
        // inspects the Redux history.
        streamUpdates.flush();
      }

      // Attach prompt log and end thinking for reasoning models
      if (next.done && next.value && isCurrentStream()) {
        scopedDispatch(addPromptCompletionPair([next.value]));

        try {
          extra.ideMessenger.post("devdata/log", {
            name: "chatInteraction",
            data: {
              prompt: next.value.prompt,
              completion: next.value.completion,
              modelProvider: selectedChatModel.underlyingProviderName,
              modelName: selectedChatModel.title,
              modelTitle: selectedChatModel.title,
              sessionId,
              ...(!!activeTools.length && {
                tools: activeTools.map((tool) => tool.function.name),
              }),
              ...(appliedRules.length > 0 && {
                rules: appliedRules.map((rule) => ({
                  id: getRuleId(rule),
                  slug: rule.slug,
                })),
              }),
            },
          });
        } catch (e) {
          console.error("Failed to send dev data interaction log", e);
        }
      }
    } catch (e) {
      if (
        selectedChatGPTBackendMode === "chatgpt" &&
        autoCompactAttempts < MAX_GUI_AUTO_COMPACTION_ATTEMPTS &&
        isChatGPTPayloadTooLargeError(e)
      ) {
        const didCompact = await compactAutomatically(
          getAutoCompactionTarget(getScopedState().session.history, 1, true),
        );
        if (didCompact) {
          unwrapResult(
            await dispatch(
              streamNormalInput({
                sessionId,
                legacySlashCommandData,
                depth: depth + 1,
                autoCompactAttempts: autoCompactAttempts + 1,
              }),
            ),
          );
          return;
        }
      }

      const toolCallsToCancel = selectCurrentToolCalls(getScopedState());
      if (
        toolCallsToCancel.length > 0 &&
        e instanceof Error &&
        e.message.toLowerCase().includes("premature close")
      ) {
        for (const tc of toolCallsToCancel) {
          scopedDispatch(
            errorToolCall({
              toolCallId: tc.toolCallId,
              output: [
                {
                  name: "Tool Call Error",
                  description: "Premature Close",
                  content: `"Premature Close" error: this tool call was aborted mid-stream because the arguments took too long to stream or there were network issues. Please re-attempt by breaking the operation into smaller chunks or trying something else`,
                  icon: "problems",
                },
              ],
            }),
          );
        }
      } else {
        throw e;
      }
    }

    // Tool call sequence:
    // 1. Mark generating tool calls as generated
    const state1 = getScopedState();
    if (streamAborter.signal.aborted || !state1.session.isStreaming) {
      return;
    }
    // selectCurrentToolCalls can still resolve the previous assistant turn
    // when a provider ends a continuation without emitting a new message.
    // Never execute or append output for those old calls again.
    const originalToolCalls = selectCurrentToolCalls(state1).filter(
      ({ toolCallId }) => !toolCallIdsBeforeStream.has(toolCallId),
    );
    const generatingCalls = originalToolCalls.filter(
      (tc) => tc.status === "generating",
    );
    for (const { toolCallId } of generatingCalls) {
      scopedDispatch(
        setToolGenerated({
          toolCallId,
          tools: state1.config.config.tools,
        }),
      );
    }

    // 2. Pre-process args to catch invalid args before checking policies
    const state2 = getScopedState();
    if (streamAborter.signal.aborted || !state2.session.isStreaming) {
      return;
    }
    const generatedCalls2 = selectPendingToolCalls(state2);
    const duplicateSkip = skipDuplicateReadonlyToolCalls(
      scopedDispatch,
      state2.session.history,
      generatedCalls2,
    );
    if (duplicateSkip.skippedToolCallIds.length > 0) {
      const stateAfterDuplicateSkip = getScopedState();
      const pendingAfterDuplicateSkip = selectPendingToolCalls(
        stateAfterDuplicateSkip,
      );
      if (pendingAfterDuplicateSkip.length === 0) {
        const currentToolCallsAfterDuplicateSkip = selectCurrentToolCalls(
          stateAfterDuplicateSkip,
        );
        if (
          duplicateSkip.shouldContinue &&
          areCurrentToolCallsComplete(
            currentToolCallsAfterDuplicateSkip,
            stateAfterDuplicateSkip.config.config.ui?.qivrynAfterToolRejection,
          )
        ) {
          unwrapResult(
            await dispatch(
              streamResponseAfterToolCall({
                sessionId,
                toolCallId: duplicateSkip.skippedToolCallIds[0],
                depth: depth + 1,
              }),
            ),
          );
        } else {
          scopedDispatch(setInactive());
        }
        return;
      }
    }
    const pendingCallsForPreprocess = selectPendingToolCalls(
      getScopedState(),
    ).filter(
      (toolCallState) =>
        !(
          isChatGPTCodexModel &&
          isReadonlyBuiltInToolCall(activeTools, toolCallState)
        ),
    );
    await preprocessToolCalls(
      scopedDispatch,
      extra.ideMessenger,
      pendingCallsForPreprocess,
    );

    // 3. Security check: evaluate updated policies based on args
    const state3 = getScopedState();
    if (streamAborter.signal.aborted || !state3.session.isStreaming) {
      return;
    }
    const generatedCalls3 = selectPendingToolCalls(state3);
    const toolPolicies = state3.ui.toolSettings;
    const canBypassPolicyForChatGPTReadonlyTools =
      isChatGPTCodexModel &&
      generatedCalls3.length > 0 &&
      generatedCalls3.every((toolCallState) =>
        isReadonlyBuiltInToolCall(activeTools, toolCallState),
      );
    const policies = canBypassPolicyForChatGPTReadonlyTools
      ? generatedCalls3.map((toolCallState) => ({
          policy: "allowedWithoutPermission" as const,
          toolCallState,
        }))
      : await evaluateToolPolicies(
          scopedDispatch,
          extra.ideMessenger,
          activeTools,
          generatedCalls3,
          toolPolicies,
          state3.ui.agentAccessMode ?? "autonomous",
        );
    const autoApprovedPolicies = policies.filter(
      ({ policy }) => policy === "allowedWithoutPermission",
    );
    const needsApprovalPolicies = policies.filter(
      ({ policy }) => policy === "allowedWithPermission",
    );

    // 4. Execute remaining tool calls
    if (originalToolCalls.length === 0) {
      scopedDispatch(setInactive());
    } else if (needsApprovalPolicies.length > 0) {
      const builtInReadonlyAutoApproved = autoApprovedPolicies.filter(
        ({ toolCallState }) =>
          toolCallState.tool?.group === BUILT_IN_GROUP_NAME &&
          toolCallState.tool?.readonly,
      );

      if (builtInReadonlyAutoApproved.length > 0) {
        const state4 = getScopedState();
        if (streamAborter.signal.aborted || !state4.session.isStreaming) {
          return;
        }
        await Promise.all(
          builtInReadonlyAutoApproved.map(async ({ toolCallState }) => {
            unwrapResult(
              await dispatch(
                callToolById({
                  sessionId,
                  toolCallId: toolCallState.toolCallId,
                  isAutoApproved: true,
                  depth: depth + 1,
                  continueAfterToolCall: false,
                }),
              ),
            );
          }),
        );
      }

      scopedDispatch(setInactive());
    } else {
      // auto stream cases increase thunk depth by 1 for debugging
      const state4 = getScopedState();
      const generatedCalls4 = selectPendingToolCalls(state4);
      if (streamAborter.signal.aborted || !state4.session.isStreaming) {
        return;
      }
      if (generatedCalls4.length > 0) {
        if (generatedCalls4.length === 1) {
          unwrapResult(
            await dispatch(
              callToolById({
                sessionId,
                toolCallId: generatedCalls4[0].toolCallId,
                isAutoApproved: true,
                depth: depth + 1,
              }),
            ),
          );
          return;
        }

        for (const { toolCallId } of generatedCalls4) {
          unwrapResult(
            await dispatch(
              callToolById({
                sessionId,
                toolCallId,
                isAutoApproved: true,
                depth: depth + 1,
                continueAfterToolCall: false,
              }),
            ),
          );
        }

        const stateAfterTools = getScopedState();
        if (
          streamAborter.signal.aborted ||
          !stateAfterTools.session.isStreaming
        ) {
          return;
        }

        const currentToolCallsAfterTools =
          selectCurrentToolCalls(stateAfterTools);
        if (
          areCurrentToolCallsComplete(
            currentToolCallsAfterTools,
            stateAfterTools.config.config.ui?.qivrynAfterToolRejection,
          )
        ) {
          unwrapResult(
            await dispatch(
              streamNormalInput({
                sessionId,
                depth: depth + 1,
              }),
            ),
          );
        } else {
          scopedDispatch(setInactive());
        }
      } else {
        for (const { toolCallId } of originalToolCalls) {
          unwrapResult(
            await dispatch(
              streamResponseAfterToolCall({
                sessionId,
                toolCallId,
                depth: depth + 1,
                continueAfterToolCall: false,
              }),
            ),
          );
        }

        const stateAfterToolMessages = getScopedState();
        const currentToolCallsAfterMessages = selectCurrentToolCalls(
          stateAfterToolMessages,
        );
        if (
          areCurrentToolCallsComplete(
            currentToolCallsAfterMessages,
            stateAfterToolMessages.config.config.ui?.qivrynAfterToolRejection,
          )
        ) {
          unwrapResult(
            await dispatch(
              streamNormalInput({
                sessionId,
                depth: depth + 1,
              }),
            ),
          );
        } else {
          scopedDispatch(setInactive());
        }
      }
    }
  },
);
