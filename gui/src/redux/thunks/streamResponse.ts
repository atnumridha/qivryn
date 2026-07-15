import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { InputModifiers } from "core";

import { v4 as uuidv4 } from "uuid";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  interruptStreamForSteering,
  resetNextCodeBlockToApplyIndex,
  setSessionChatModelTitle,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";

const activeSessionStreams = new Map<string, Promise<void>>();

function registerSessionStream(
  sessionId: string,
  currentStream: Promise<void>,
): Promise<void> | undefined {
  const previousStream = activeSessionStreams.get(sessionId);
  activeSessionStreams.set(sessionId, currentStream);
  return previousStream;
}

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
    sessionId?: string;
    steerActiveRun?: boolean;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    {
      editorState,
      modifiers,
      index,
      sessionId: requestedSessionId,
      steerActiveRun = false,
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
    let releaseSessionStream!: () => void;
    const currentSessionStream = new Promise<void>((resolve) => {
      releaseSessionStream = resolve;
    });
    const previousSessionStream = registerSessionStream(
      sessionId,
      currentSessionStream,
    );

    try {
      await dispatch(
        streamThunkWrapper(async () => {
          const state = getScopedState();
          const selectedChatModel = selectSelectedChatModel(state);
          const inputIndex = index ?? state.session.history.length;

          if (!selectedChatModel) {
            throw new Error("No chat model selected");
          }
          if (steerActiveRun) {
            scopedDispatch(interruptStreamForSteering());
          }
          scopedDispatch(
            submitEditorAndInitAtIndex({
              index: inputIndex,
              editorState,
              ...(steerActiveRun
                ? { appendWithoutResponsePlaceholder: true }
                : {}),
            }),
          );

          scopedDispatch(resetNextCodeBlockToApplyIndex());
          scopedDispatch(setSessionChatModelTitle(selectedChatModel.title));

          const defaultContextProviders =
            state.config.config.experimental?.defaultContext ?? [];
          const {
            selectedContextItems,
            selectedCode,
            content,
            legacyCommandWithInput,
          } = await resolveEditorContent({
            editorState,
            modifiers,
            ideMessenger: extra.ideMessenger,
            defaultContextProviders,
            availableSlashCommands: state.config.config.slashCommands,
            dispatch: scopedDispatch,
            getState: getScopedState,
          });

          const filesForSymbols = [
            ...selectedContextItems
              .filter((item) => item.uri?.type === "file" && item?.uri?.value)
              .map((item) => item.uri!.value),
            ...selectedCode.map((rif) => rif.filepath),
          ];
          void dispatch(updateFileSymbolsFromFiles(filesForSymbols));

          scopedDispatch(
            updateHistoryItemAtIndex({
              index: inputIndex,
              updates: {
                message: {
                  role: "user",
                  content,
                  id: uuidv4(),
                },
                contextItems: selectedContextItems,
              },
            }),
          );

          const queuedController = getScopedState().session.streamAborter;
          if (previousSessionStream) {
            await previousSessionStream.catch(() => undefined);
          }
          const currentState = getScopedState().session;
          if (
            !currentState.isStreaming ||
            currentState.streamAborter !== queuedController ||
            queuedController.signal.aborted
          ) {
            return;
          }

          unwrapResult(
            await dispatch(
              streamNormalInput({
                legacySlashCommandData: legacyCommandWithInput
                  ? {
                      command: legacyCommandWithInput.command,
                      contextItems: selectedContextItems,
                      historyIndex: inputIndex,
                      input: legacyCommandWithInput.input,
                      selectedCode,
                    }
                  : undefined,
              }),
            ),
          );
        }),
      );
    } finally {
      releaseSessionStream();
      if (activeSessionStreams.get(sessionId) === currentSessionStream) {
        activeSessionStreams.delete(sessionId);
      }
    }
  },
);
