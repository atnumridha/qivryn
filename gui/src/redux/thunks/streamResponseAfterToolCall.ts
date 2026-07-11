import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage } from "core";
import { renderContextItems } from "core/util/messageContent";
import { selectCurrentToolCalls } from "../selectors/selectToolCalls";
import {
  ChatHistoryItemWithMessageId,
  resetNextCodeBlockToApplyIndex,
  streamUpdate,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  findSessionIdForToolCall,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";

/**
 * Determines if we should continue streaming based on tool call completion status.
 */
export function areAllToolsDoneStreaming(
  assistantMessage: ChatHistoryItemWithMessageId,
  qivrynAfterToolRejection: boolean | undefined,
): boolean {
  // This might occur because of race conditions, if so, the tools are completed
  if (!assistantMessage.toolCallStates) {
    return true;
  }

  // Only continue if all tool calls are complete
  const completedToolCalls = assistantMessage.toolCallStates.filter(
    (tc) =>
      tc.status === "done" ||
      tc.status === "errored" ||
      (qivrynAfterToolRejection && tc.status === "canceled"),
  );

  return completedToolCalls.length === assistantMessage.toolCallStates.length;
}

export const streamResponseAfterToolCall = createAsyncThunk<
  void,
  {
    toolCallId: string;
    depth?: number;
    continueAfterToolCall?: boolean;
    sessionId?: string;
  },
  ThunkApiType
>(
  "chat/streamAfterToolCall",
  async (
    {
      toolCallId,
      depth = 0,
      continueAfterToolCall = true,
      sessionId: requestedSessionId,
    },
    { dispatch, getState },
  ) => {
    const sessionId =
      requestedSessionId ??
      findSessionIdForToolCall(getState(), toolCallId) ??
      getState().session.id;
    const getScopedState = () => getRootStateForSession(getState(), sessionId);
    const scopedDispatch = createSessionScopedDispatch(
      dispatch,
      sessionId,
      getState,
    );

    const runStream = async () => {
      const state = getScopedState();
      const currentToolCalls = selectCurrentToolCalls(state);
      const toolCallState = currentToolCalls.find(
        (tc) => tc.toolCallId === toolCallId,
      );

      if (!toolCallState) {
        return; // in cases where edit tool is cancelled mid apply, this will be triggered
      }

      const toolOutput = toolCallState.output ?? [];

      scopedDispatch(resetNextCodeBlockToApplyIndex());

      // Create and dispatch the tool message
      const newMessage: ChatMessage = {
        role: "tool",
        content: renderContextItems(toolOutput),
        toolCallId,
      };
      scopedDispatch(streamUpdate([newMessage]));

      // Check if we should continue streaming based on tool call completion
      const history = getScopedState().session.history;
      const assistantMessage = history.findLast(
        (item) =>
          item.message.role === "assistant" &&
          item.toolCallStates?.some((tc) => tc.toolCallId === toolCallId),
      );

      if (
        continueAfterToolCall &&
        assistantMessage &&
        areAllToolsDoneStreaming(
          assistantMessage,
          state.config.config.ui?.qivrynAfterToolRejection,
        )
      ) {
        unwrapResult(
          await dispatch(
            streamNormalInput({
              ...(getState().session.id === sessionId ? {} : { sessionId }),
              depth: depth + 1,
            }),
          ),
        );
      }
    };

    await dispatch(
      streamThunkWrapper(
        getState().session.id === sessionId
          ? runStream
          : { sessionId, runStream },
      ),
    );
  },
);
