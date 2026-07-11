import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  abortStream,
  clearDanglingMessages,
  setInactive,
} from "../slices/sessionSlice";
import { createSessionScopedDispatch } from "../sessionRuntime";
import { ThunkApiType } from "../store";

export const cancelStream = createAsyncThunk<
  void,
  { sessionId?: string } | undefined,
  ThunkApiType
>("chat/cancelStream", async (input, { dispatch, getState }) => {
  const sessionId = input?.sessionId ?? getState().session.id;
  const scopedDispatch = createSessionScopedDispatch(
    dispatch,
    sessionId,
    getState,
  );

  scopedDispatch(setInactive());
  scopedDispatch(abortStream());

  // Clear any dangling incomplete tool calls, thinking messages, etc.
  scopedDispatch(clearDanglingMessages());
});
