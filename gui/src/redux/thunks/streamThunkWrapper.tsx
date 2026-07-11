import { createAsyncThunk } from "@reduxjs/toolkit";

import StreamErrorDialog from "../../pages/gui/StreamError";
import { analyzeError } from "../../util/errorAnalysis";

const OVERLOADED_RETRIES = 3;
const OVERLOADED_DELAY_MS = 2000;

function isOverloadedErrorMessage(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("overloaded") || lower.includes("529");
}
import { selectSelectedChatModel } from "../slices/configSlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { getRootStateForSession } from "../sessionRuntime";
import { cancelStream } from "./cancelStream";
import { saveCurrentSession } from "./session";

type StreamThunkInput =
  | (() => Promise<void>)
  | {
      runStream: () => Promise<void>;
      sessionId?: string;
    };

export const streamThunkWrapper = createAsyncThunk<
  void,
  StreamThunkInput,
  ThunkApiType
>("chat/streamWrapper", async (input, { dispatch, getState }) => {
  const runStream = typeof input === "function" ? input : input.runStream;
  const sessionId =
    typeof input === "function"
      ? getState().session.id
      : (input.sessionId ?? getState().session.id);

  for (let attempt = 0; attempt <= OVERLOADED_RETRIES; attempt++) {
    try {
      await runStream();
      const state = getRootStateForSession(getState(), sessionId);
      if (!state.session.isInEdit) {
        await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: true,
            ...(getState().session.id === sessionId ? {} : { sessionId }),
          }),
        );
      }
      return;
    } catch (e) {
      // Get the selected model from the state for error analysis
      const state = getRootStateForSession(getState(), sessionId);
      const selectedModel =
        state.config.config?.modelsByRole?.chat?.find(
          (model) => model.title === state.session.chatModelTitle,
        ) ?? selectSelectedChatModel(state);
      const { message } = analyzeError(e, selectedModel);

      const shouldRetry =
        isOverloadedErrorMessage(message) && attempt < OVERLOADED_RETRIES;
      const cancelTarget =
        getState().session.id === sessionId ? undefined : { sessionId };

      if (shouldRetry) {
        await dispatch(cancelStream(cancelTarget));
        const delayMs = OVERLOADED_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await dispatch(cancelStream(cancelTarget));
      } else {
        await dispatch(cancelStream(cancelTarget));
        if (getState().session.id === sessionId) {
          dispatch(setDialogMessage(<StreamErrorDialog error={e} />));
          dispatch(setShowDialog(true));
        } else {
          console.error(`Background session ${sessionId} failed`, e);
        }

        return;
      }
    }
  }
});
