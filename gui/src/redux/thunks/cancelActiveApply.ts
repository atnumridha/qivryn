import { createAsyncThunk } from "@reduxjs/toolkit";
import { updateEditStateApplyState } from "../slices/editState";
import { cancelToolCall, updateApplyState } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallById } from "../util";
import { cancelStream } from "./cancelStream";

/** Abort active apply operations and immediately release the stuck apply UI. */
export const cancelActiveApply = createAsyncThunk<
  void,
  undefined,
  ThunkApiType
>("apply/cancelActive", async (_, { dispatch, extra, getState }) => {
  const state = getState();
  const activeApplyStates = state.session.codeBlockApplyStates.states.filter(
    (applyState) => applyState.status === "streaming",
  );
  const editApplyState = state.editModeState.applyState;
  const isEditApplyActive = editApplyState.status === "streaming";

  // Stop response generation as well as the apply operation. The apply abort is
  // sent below with the most specific file/stream identity available.
  void dispatch(cancelStream());

  for (const applyState of activeApplyStates) {
    const toolCallState = applyState.toolCallId
      ? findToolCallById(state.session.history, applyState.toolCallId)
      : undefined;
    const args = toolCallState?.processedArgs ?? toolCallState?.parsedArgs;
    const filepath =
      applyState.filepath ??
      (typeof args?.filepath === "string" ? args.filepath : undefined);

    if (applyState.toolCallId) {
      dispatch(cancelToolCall({ toolCallId: applyState.toolCallId }));
    }

    extra.ideMessenger.post("rejectDiff", {
      filepath,
      streamId: applyState.streamId,
    });

    // Do not make the user wait for the extension host to unwind a stalled
    // stream before restoring control of the input.
    dispatch(
      updateApplyState({
        ...applyState,
        filepath,
        status: "closed",
        numDiffs: 0,
      }),
    );
  }

  if (isEditApplyActive) {
    const filepath =
      editApplyState.filepath ?? state.editModeState.codeToEdit[0]?.filepath;
    extra.ideMessenger.post("rejectDiff", {
      filepath,
      streamId: editApplyState.streamId,
    });
    dispatch(
      updateEditStateApplyState({
        ...editApplyState,
        filepath,
        status: "closed",
        numDiffs: 0,
      }),
    );
  }

  // Retain a backend escape hatch even for legacy/persisted apply state that
  // lacks an active entry.
  if (activeApplyStates.length === 0 && !isEditApplyActive) {
    extra.ideMessenger.post("rejectDiff", {});
  }
});
