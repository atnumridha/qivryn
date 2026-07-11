import { createAsyncThunk } from "@reduxjs/toolkit";
import { ApplyState, ApplyToFilePayload } from "core";
import { EDIT_MODE_STREAM_ID } from "core/edit/constants";
import { logAgentModeEditOutcome } from "../../util/editOutcomeLogger";
import {
  selectApplyStateByToolCallId,
  selectToolCallById,
} from "../selectors/selectToolCalls";
import { updateEditStateApplyState } from "../slices/editState";
import {
  acceptToolCall,
  errorToolCall,
  updateApplyState,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  findSessionIdForApplyState,
  findSessionIdForToolCall,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { exitEdit } from "./edit";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

export const handleApplyStateUpdate = createAsyncThunk<
  void,
  ApplyState & { sessionId?: string },
  ThunkApiType
>(
  "apply/handleStateUpdate",
  async (applyState, { dispatch, getState, extra }) => {
    if (applyState.streamId === EDIT_MODE_STREAM_ID) {
      dispatch(updateEditStateApplyState(applyState));

      if (applyState.status === "closed") {
        const toolCallState = findToolCallById(
          getState().session.history,
          applyState.toolCallId!,
        );
        if (toolCallState) {
          logToolUsage(toolCallState, true, true, extra.ideMessenger);
        }
        void dispatch(exitEdit({}));
      }
    } else {
      // chat or agent
      const sessionId =
        applyState.sessionId ??
        findSessionIdForApplyState(getState(), applyState) ??
        (applyState.toolCallId
          ? findSessionIdForToolCall(getState(), applyState.toolCallId)
          : undefined) ??
        getState().session.id;
      const getScopedState = () =>
        getRootStateForSession(getState(), sessionId);
      const scopedDispatch = createSessionScopedDispatch(
        dispatch,
        sessionId,
        getState,
      );
      const { sessionId: _sessionId, ...scopedApplyState } = applyState;

      scopedDispatch(updateApplyState(scopedApplyState));

      // Handle apply status updates - use toolCallId from event payload
      if (applyState.toolCallId) {
        const toolCallState = findToolCallById(
          getScopedState().session.history,
          applyState.toolCallId,
        );

        if (
          applyState.status === "done" &&
          toolCallState?.toolCall.function.name &&
          getScopedState().ui.toolSettings[
            toolCallState.toolCall.function.name
          ] === "allowedWithoutPermission"
        ) {
          extra.ideMessenger.post("acceptDiff", {
            streamId: applyState.streamId,
            filepath: applyState.filepath,
          });
        }

        if (applyState.status === "closed") {
          if (toolCallState) {
            const accepted = toolCallState.status !== "canceled";

            logToolUsage(toolCallState, accepted, true, extra.ideMessenger);

            // Log edit outcome for Agent Mode
            const newApplyState =
              getScopedState().session.codeBlockApplyStates.states.find(
                (s) => s.streamId === applyState.streamId,
              );
            const newState = getScopedState();
            if (newApplyState) {
              void logAgentModeEditOutcome(
                newState.session.history,
                newState.config.config,
                toolCallState,
                newApplyState,
                accepted,
                extra.ideMessenger,
              );
            }

            if (accepted) {
              if (toolCallState.status !== "errored") {
                scopedDispatch(
                  acceptToolCall({
                    toolCallId: applyState.toolCallId,
                  }),
                );

                // Add autoformatting diff to tool output if present
                if (applyState.autoFormattingDiff) {
                  scopedDispatch(
                    updateToolCallOutput({
                      toolCallId: applyState.toolCallId,
                      contextItems: [
                        {
                          icon: "info",
                          name: "Auto-formatting Applied",
                          description: "Editor auto-formatting changes",
                          content: `Along with your edits, the editor applied the following auto-formatting:\n\n${applyState.autoFormattingDiff}\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)`,
                          hidden: false,
                        },
                      ],
                    }),
                  );
                } else {
                  scopedDispatch(
                    updateToolCallOutput({
                      toolCallId: applyState.toolCallId,
                      contextItems: [
                        {
                          name: "Edit Success",
                          content: `Successfully edited ${applyState.filepath}`,
                          description: "",
                          hidden: true,
                        },
                      ],
                    }),
                  );
                }
              } else {
                scopedDispatch(
                  updateToolCallOutput({
                    toolCallId: applyState.toolCallId,
                    contextItems: [
                      {
                        name: "Edit Failed",
                        content: `Failed to edit ${applyState.filepath}. To continue working with the file, read it again to see the most up-to-date contents`,
                        description: "",
                        hidden: true,
                      },
                    ],
                  }),
                );
              }

              void dispatch(
                streamResponseAfterToolCall({
                  sessionId,
                  toolCallId: applyState.toolCallId,
                }),
              );
            }
          }
        }
      }
    }
  },
);

export const applyForEditTool = createAsyncThunk<
  void,
  ApplyToFilePayload & { toolCallId: string; sessionId?: string },
  ThunkApiType
>("apply/editTool", async (payload, { dispatch, getState, extra }) => {
  const { toolCallId, streamId, sessionId: requestedSessionId } = payload;
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

  scopedDispatch(
    updateApplyState({
      streamId,
      toolCallId,
      filepath: payload.filepath,
      status: "not-started",
    }),
  );

  let didError = false;
  try {
    const { sessionId: _sessionId, ...applyPayload } = payload;
    const response = await extra.ideMessenger.request(
      "applyToFile",
      applyPayload,
    );
    if (response.status === "error") {
      didError = true;
    }
  } catch (e) {
    didError = true;
  }
  if (didError) {
    const state = getScopedState();

    const toolCallState = selectToolCallById(state, toolCallId);
    const applyState = selectApplyStateByToolCallId(state, toolCallId);
    if (
      toolCallState &&
      applyState &&
      applyState.status !== "closed" &&
      toolCallState.status === "calling"
    ) {
      scopedDispatch(
        errorToolCall({
          toolCallId,
        }),
      );
      scopedDispatch(
        updateToolCallOutput({
          toolCallId,
          contextItems: [
            {
              icon: "problems",
              name: "Apply Error",
              description: "Failed to apply changes",
              content: `Error editing file: failed to apply changes to file.\n\nPlease try again with correct args or notify the user and request further instructions.`,
              hidden: false,
            },
          ],
        }),
      );
      void dispatch(
        handleApplyStateUpdate({
          sessionId,
          status: "closed",
          streamId: applyState.streamId,
          toolCallId,
        }),
      );
    }
  }
});
