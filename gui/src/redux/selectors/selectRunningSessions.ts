import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import type { SessionRuntimeState } from "../slices/sessionSlice";

export interface RunningSessionSummary {
  sessionId: string;
  title: string;
  messageCount: number;
}

function summarizeRuntime(
  sessionId: string,
  runtime: SessionRuntimeState,
): RunningSessionSummary {
  return {
    sessionId,
    title: runtime.title,
    messageCount: runtime.history.filter(
      (item) => item.message.role === "assistant",
    ).length,
  };
}

export const selectRunningSessionSummaries = createSelector(
  [(state: RootState) => state.session],
  (session): RunningSessionSummary[] => {
    const running: RunningSessionSummary[] = [];

    if (session.isStreaming) {
      running.push(summarizeRuntime(session.id, session));
    }

    for (const [sessionId, runtime] of Object.entries(
      session.backgroundSessionStates ?? {},
    )) {
      if (runtime.isStreaming && sessionId !== session.id) {
        running.push(summarizeRuntime(sessionId, runtime));
      }
    }

    return running;
  },
);

export const selectRunningSessionIdsValue = createSelector(
  [selectRunningSessionSummaries],
  (sessions) => sessions.map((session) => session.sessionId).join("\u0000"),
);
