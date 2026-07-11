import { createAsyncThunk } from "@reduxjs/toolkit";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectPendingToolCalls } from "../selectors/selectToolCalls";
import { AgentAccessMode, setAgentAccessMode } from "../slices/uiSlice";
import {
  createSessionScopedDispatch,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { callToolById } from "./callToolById";
import { evaluateToolPolicies } from "./evaluateToolPolicies";

/** Update the access mode and immediately re-evaluate existing approvals. */
export const setAgentAccessModeAndReleasePending = createAsyncThunk<
  void,
  AgentAccessMode,
  ThunkApiType
>("ui/setAgentAccessModeAndReleasePending", async (mode, api) => {
  api.dispatch(setAgentAccessMode(mode));

  if (mode === "ask" || mode === "readOnly") {
    return;
  }

  const sessionId = api.getState().session.id;
  const state = getRootStateForSession(api.getState(), sessionId);
  const scopedDispatch = createSessionScopedDispatch(
    api.dispatch,
    sessionId,
    api.getState,
  );
  const pendingToolCalls = selectPendingToolCalls(state);
  if (pendingToolCalls.length === 0) {
    return;
  }

  const policies = await evaluateToolPolicies(
    scopedDispatch,
    api.extra.ideMessenger,
    selectActiveTools(state),
    pendingToolCalls,
    state.ui.toolSettings,
    mode,
  );

  await Promise.all(
    policies
      .filter(({ policy }) => policy === "allowedWithoutPermission")
      .map(({ toolCallState }) =>
        api.dispatch(
          callToolById({
            sessionId,
            toolCallId: toolCallState.toolCallId,
            isAutoApproved: true,
          }),
        ),
      ),
  );
});
