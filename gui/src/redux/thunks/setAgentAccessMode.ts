import { createAsyncThunk } from "@reduxjs/toolkit";
import { selectActiveTools } from "../selectors/selectActiveTools";
import { selectPendingToolCalls } from "../selectors/selectToolCalls";
import { AgentAccessMode, setAgentAccessMode } from "../slices/uiSlice";
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

  const state = api.getState();
  const pendingToolCalls = selectPendingToolCalls(state);
  if (pendingToolCalls.length === 0) {
    return;
  }

  const policies = await evaluateToolPolicies(
    api.dispatch,
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
            toolCallId: toolCallState.toolCallId,
            isAutoApproved: true,
          }),
        ),
      ),
  );
});
