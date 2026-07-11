import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { BaseSessionMetadata, ChatMessage, Session } from "core";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { renderChatMessage } from "core/util/messageContent";
import { IIdeMessenger } from "../../context/IdeMessenger";
import { selectSelectedChatModel } from "../slices/configSlice";
import { selectSelectedProfile } from "../slices/profilesSlice";
import {
  deleteSessionMetadata,
  getSessionRuntimeById,
  hydratePersistedSession,
  newSession,
  setAllSessionMetadata,
  setIsSessionMetadataLoading,
  updateSessionMetadata,
  updateSessionTitle,
} from "../slices/sessionSlice";
import {
  createSessionScopedDispatch,
  getRootStateForSession,
} from "../sessionRuntime";
import { ThunkApiType } from "../store";
import { updateSelectedModelByRole } from "../thunks/updateSelectedModelByRole";

const MAX_TITLE_LENGTH = 100;
const LEGACY_NEW_SESSION_TITLES = new Set([
  NEW_SESSION_TITLE.toLowerCase(),
  "untitled session",
]);

export function isPlaceholderSessionTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized.length === 0 || LEGACY_NEW_SESSION_TITLES.has(normalized);
}

// Async session functions live in thunks (because of IDE messaging mostly)
// see sessionSlice for sync redux session functions

export async function getSession(
  ideMessenger: IIdeMessenger,
  id: string,
): Promise<Session> {
  const result = await ideMessenger.request("history/load", { id });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.content;
}

export const refreshSessionMetadata = createAsyncThunk<
  BaseSessionMetadata[],
  {
    offset?: number;
    limit?: number;
  },
  ThunkApiType
>("session/refreshMetadata", async ({ offset, limit }, { dispatch, extra }) => {
  const result = await extra.ideMessenger.request("history/list", {
    limit,
    offset,
  });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  dispatch(setIsSessionMetadataLoading(false));
  dispatch(setAllSessionMetadata(result.content));
  return result.content;
});

export const deleteSession = createAsyncThunk<void, string, ThunkApiType>(
  "session/delete",
  async (id, { getState, dispatch, extra }) => {
    dispatch(deleteSessionMetadata(id)); // optimistic
    const state = getState();
    if (id === state.session.id) {
      await dispatch(loadLastSession());
    }
    const result = await extra.ideMessenger.request("history/delete", { id });
    if (result.status === "error") {
      throw new Error(result.error);
    }
    void dispatch(refreshSessionMetadata({}));
  },
);

export const updateSession = createAsyncThunk<void, Session, ThunkApiType>(
  "session/update",
  async (session, { extra, dispatch }) => {
    dispatch(
      updateSessionMetadata({
        sessionId: session.sessionId,
        title: session.title,
      }),
    ); // optimistic session metadata update
    await extra.ideMessenger.request("history/save", session);
    await dispatch(refreshSessionMetadata({}));
  },
);

/*
 this is only used for the custom focusQivrynSessionId command at the moment
*/
export const loadSession = createAsyncThunk<
  void,
  {
    sessionId: string;
    saveCurrentSession: boolean;
    forceReload?: boolean;
  },
  ThunkApiType
>(
  "session/load",
  async (
    { sessionId, saveCurrentSession: save, forceReload = false },
    { extra, dispatch, getState },
  ) => {
    if (save) {
      // save the session in the background
      void dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      );
    }
    const cachedRuntime = forceReload
      ? undefined
      : getSessionRuntimeById(getState().session, sessionId);
    const session: Session = cachedRuntime
      ? {
          sessionId,
          title: cachedRuntime.title,
          workspaceDirectory: window.workspacePaths?.[0] || "",
          history: cachedRuntime.history,
          mode: cachedRuntime.mode,
          chatModelTitle: cachedRuntime.chatModelTitle ?? null,
        }
      : await getSession(extra.ideMessenger, sessionId);
    if (forceReload && getState().session.id === sessionId) {
      dispatch(hydratePersistedSession(session));
    } else {
      dispatch(newSession(session));
    }

    // Restore selected chat model from session, if present
    if (session.chatModelTitle) {
      void dispatch(selectChatModelForProfile(session.chatModelTitle));
    }
  },
);

export const selectChatModelForProfile = createAsyncThunk<
  void,
  string,
  ThunkApiType
>(
  "session/selectModelForCurrentProfile",
  async (modelTitle, { extra, dispatch, getState }) => {
    const state = getState();
    const modelMatch = state.config.config?.modelsByRole?.chat?.find(
      (m) => m.title === modelTitle,
    );
    const selectedProfile = selectSelectedProfile(state);
    if (selectedProfile && modelMatch) {
      await dispatch(
        updateSelectedModelByRole({
          role: "chat",
          modelTitle: modelTitle,
          selectedProfile,
        }),
      );
    }
  },
);

export const loadLastSession = createAsyncThunk<void, void, ThunkApiType>(
  "session/loadLast",
  async (_, { extra, dispatch, getState }) => {
    let lastSessionId = getState().session.lastSessionId;

    // const lastSessionResult = await extra.ideMessenger.request("history/list", {
    //   limit: 1,
    // });
    // if (lastSessionResult.status === "success") {
    //   lastSessionId = lastSessionResult.content.at(0)?.sessionId;
    // }

    if (!lastSessionId) {
      dispatch(newSession());
      return;
    }

    let session: Session;
    try {
      session = await getSession(extra.ideMessenger, lastSessionId);
    } catch {
      // retry again after 1 sec
      await new Promise((resolve) => setTimeout(resolve, 1000));
      session = await getSession(extra.ideMessenger, lastSessionId);
    }
    dispatch(newSession(session));
    if (session.chatModelTitle) {
      dispatch(selectChatModelForProfile(session.chatModelTitle));
    }
  },
);

function getChatTitleFromMessage(message: ChatMessage) {
  const text =
    renderChatMessage(message)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .slice(-1)[0] || "";

  // Truncate
  if (text.length > MAX_TITLE_LENGTH) {
    return text.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }
  return text;
}

export const saveCurrentSession = createAsyncThunk<
  void,
  {
    openNewSession: boolean;
    generateTitle: boolean;
    sessionId?: string;
  },
  ThunkApiType
>(
  "session/saveCurrent",
  async (
    { openNewSession, generateTitle, sessionId: requestedSessionId },
    { dispatch, extra, getState },
  ) => {
    const sessionId = requestedSessionId ?? getState().session.id;
    const session = getRootStateForSession(getState(), sessionId).session;
    if (session.history.length === 0) {
      return;
    }

    if (openNewSession && getState().session.id === sessionId) {
      dispatch(newSession());
    }

    const selectedChatModel =
      getState().config.config?.modelsByRole?.chat?.find(
        (model) => model.title === session.chatModelTitle,
      ) ?? selectSelectedChatModel(getState());

    // New session has already been dispatched
    // Now save previous session and update chat title if relevant
    let title = session.title;
    if (isPlaceholderSessionTitle(title)) {
      if (
        !getState().config.config?.disableSessionTitles &&
        selectedChatModel
      ) {
        let assistantResponse = session.history
          ?.filter((h) => h.message.role === "assistant")[0]
          ?.message?.content?.toString();

        if (assistantResponse && generateTitle) {
          try {
            const result = await extra.ideMessenger.request(
              "chatDescriber/describe",
              {
                text: assistantResponse,
              },
            );
            if (result.status === "success" && result.content) {
              title = result.content;
            }
          } catch (e) {
            console.error("Error generating chat title", e);
          }
        }
      }
      // Fallbacks if above doesn't work out or session titles disabled
      if (isPlaceholderSessionTitle(title)) {
        title = getChatTitleFromMessage(session.history[0].message);
      }
    }
    // More fallbacks in case of no title
    if (!title.length) {
      const metadata = session.allSessionMetadata.find(
        (m) => m.sessionId === session.id,
      );
      if (metadata?.title) {
        title = metadata.title;
      }
    }
    if (!title.length) {
      title = NEW_SESSION_TITLE;
    }

    const updatedSession: Session = {
      sessionId: session.id,
      title,
      workspaceDirectory: window.workspacePaths?.[0] || "",
      history: session.history,
      mode: session.mode,
      chatModelTitle:
        session.chatModelTitle ?? selectedChatModel?.title ?? null,
    };

    const result = await dispatch(updateSession(updatedSession));
    unwrapResult(result);
    if (getState().session.id !== sessionId) {
      createSessionScopedDispatch(
        dispatch,
        sessionId,
        getState,
      )(updateSessionTitle(title));
    }
  },
);
