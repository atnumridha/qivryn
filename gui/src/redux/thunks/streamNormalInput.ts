import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { LLMFullCompletionOptions, ModelDescription } from "core";
import { getRuleId } from "core/llm/rules/getSystemMessageWithRules";
import { ToCoreProtocol } from "core/protocol";
import { BUILT_IN_GROUP_NAME } from "core/tools/builtIn";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
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
import { addSystemMessageToolsToSystemMessage } from "core/tools/systemMessageTools/buildToolsSystemMessage";
import { interceptSystemToolCalls } from "core/tools/systemMessageTools/interceptSystemToolCalls";
import { SystemMessageToolCodeblocksFramework } from "core/tools/systemMessageTools/toolCodeblocks";

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

    // Use the centralized selector to determine if system message tools should be used
    const useNativeTools = state.config.config.experimental
      ?.onlyUseSystemMessageTools
      ? false
      : modelSupportsNativeTools(selectedChatModel);
    const systemToolsFramework = !useNativeTools
      ? new SystemMessageToolCodeblocksFramework()
      : undefined;

    // Construct completion options
    let completionOptions: LLMFullCompletionOptions = {};
    if (useNativeTools && activeTools.length > 0) {
      completionOptions = {
        tools: activeTools,
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
      activeTools,
    );

    const systemMessage = systemToolsFramework
      ? addSystemMessageToolsToSystemMessage(
          systemToolsFramework,
          baseSystemMessage,
          activeTools,
        )
      : baseSystemMessage;

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

    const precompiledRes = await extra.ideMessenger.request("llm/compileChat", {
      messages,
      options: completionOptions,
    });

    if (precompiledRes.status === "error") {
      if (precompiledRes.error.includes("Not enough context")) {
        const didCompact =
          autoCompactAttempts < MAX_GUI_AUTO_COMPACTION_ATTEMPTS &&
          (await compactAutomatically(
            getAutoCompactionTarget(getScopedState().session.history, 1, true),
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
      compiledChatMessages,
      didPrune,
      contextPercentage,
      inputTokens,
      contextLength,
      availableTokens,
    } = precompiledRes.content;

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

    const start = Date.now();
    const streamAborter = state.session.streamAborter;
    const toolCallIdsBeforeStream = new Set(
      selectCurrentToolCalls(getScopedState()).map(
        ({ toolCallId }) => toolCallId,
      ),
    );
    try {
      let gen = extra.ideMessenger.llmStreamChat(
        {
          completionOptions,
          title: selectedChatModel.title,
          messages: compiledChatMessages,
          legacySlashCommandData,
          messageOptions: { precompiled: true },
        },
        streamAborter.signal,
      );
      if (systemToolsFramework && activeTools.length > 0) {
        gen = interceptSystemToolCalls(
          gen,
          streamAborter,
          systemToolsFramework,
        );
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
    await preprocessToolCalls(
      scopedDispatch,
      extra.ideMessenger,
      generatedCalls2,
    );

    // 3. Security check: evaluate updated policies based on args
    const state3 = getScopedState();
    if (streamAborter.signal.aborted || !state3.session.isStreaming) {
      return;
    }
    const generatedCalls3 = selectPendingToolCalls(state3);
    const toolPolicies = state3.ui.toolSettings;
    const policies = await evaluateToolPolicies(
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
