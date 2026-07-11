import { createAsyncThunk } from "@reduxjs/toolkit";

import {
  cancelToolCall as cancelToolCallAction,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  findSessionIdForToolCall,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";

import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

const DEFAULT_USER_REJECTION_MESSAGE = `The user skipped the tool call.
If the tool call is optional or non-critical to the main goal, skip it and continue with the next step.
If the tool call is essential, try an alternative approach.
If no alternatives exist, offer to pause here.`;

export const cancelToolCallThunk = createAsyncThunk<
  void,
  { toolCallId: string },
  ThunkApiType
>("chat/cancelToolCall", async ({ toolCallId }, { dispatch, getState }) => {
  const sessionId =
    findSessionIdForToolCall(getState(), toolCallId) ?? getState().session.id;
  const state = getRootStateForSession(getState(), sessionId);
  const scopedDispatch = createSessionScopedDispatch(
    dispatch,
    sessionId,
    getState,
  );
  const qivrynAfterToolRejection =
    state.config.config.ui?.qivrynAfterToolRejection;

  if (qivrynAfterToolRejection) {
    // Update tool call output with rejection message
    scopedDispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Tool Call Rejected",
            description: "User skipped the tool call",
            content: DEFAULT_USER_REJECTION_MESSAGE,
            hidden: true,
          },
        ],
      }),
    );
  }

  // Dispatch the actual cancel action
  scopedDispatch(cancelToolCallAction({ toolCallId }));

  void dispatch(streamResponseAfterToolCall({ sessionId, toolCallId }));
});
