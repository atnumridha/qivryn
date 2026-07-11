import type { UnknownAction } from "@reduxjs/toolkit";
import type { AppThunkDispatch, RootState } from "./store";
import {
  getSessionRuntimeById,
  scopeSessionAction,
  type SessionRuntimeState,
} from "./slices/sessionSlice";

/**
 * Present a conversation runtime as the active session to existing selectors.
 * Shared configuration and UI state still come from the live Redux root.
 */
export function getRootStateForSession(
  state: RootState,
  sessionId: string,
): RootState {
  if (state.session.id === sessionId) {
    return state;
  }

  const runtime = getSessionRuntimeById(state.session, sessionId);
  if (!runtime) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      ...runtime,
    },
  };
}

/** Scope plain session actions while leaving nested thunks responsible for
 * carrying the same session id in their input.
 */
export function createSessionScopedDispatch(
  dispatch: AppThunkDispatch,
  sessionId: string,
  getState: () => RootState,
): AppThunkDispatch {
  return ((action: UnknownAction | ((...args: any[]) => unknown)) => {
    if (typeof action === "function") {
      return dispatch(action as any);
    }
    return dispatch(
      getState().session.id === sessionId
        ? action
        : scopeSessionAction(action, sessionId),
    );
  }) as AppThunkDispatch;
}

function runtimeContainsToolCall(
  runtime: SessionRuntimeState,
  toolCallId: string,
): boolean {
  return (runtime.history ?? []).some((item) =>
    item.toolCallStates?.some((toolCall) => toolCall.toolCallId === toolCallId),
  );
}

export function findSessionIdForToolCall(
  state: RootState,
  toolCallId: string,
): string | undefined {
  if (runtimeContainsToolCall(state.session, toolCallId)) {
    return state.session.id;
  }

  return Object.entries(state.session.backgroundSessionStates ?? {}).find(
    ([, runtime]) => runtimeContainsToolCall(runtime, toolCallId),
  )?.[0];
}

export function findSessionIdForApplyState(
  state: RootState,
  applyState: { streamId?: string; toolCallId?: string },
): string | undefined {
  const matches = (runtime: SessionRuntimeState) =>
    (runtime.codeBlockApplyStates?.states ?? []).some(
      (candidate) =>
        (applyState.streamId && candidate.streamId === applyState.streamId) ||
        (applyState.toolCallId &&
          candidate.toolCallId === applyState.toolCallId),
    );

  if (matches(state.session)) {
    return state.session.id;
  }

  return Object.entries(state.session.backgroundSessionStates ?? {}).find(
    ([, runtime]) => matches(runtime),
  )?.[0];
}
