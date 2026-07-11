import { describe, expect, test } from "vitest";
import type { Session } from "core";
import sessionReducer, {
  abortStream,
  newSession,
  scopeSessionAction,
  streamUpdate,
  submitEditorAndInitAtIndex,
} from "./sessionSlice";

const EMPTY_EDITOR_STATE = { type: "doc", content: [] };

function savedSession(sessionId: string, title: string): Session {
  return {
    sessionId,
    title,
    workspaceDirectory: "",
    history: [],
    mode: "agent",
    chatModelTitle: "test-model",
  };
}

describe("per-session conversation runtimes", () => {
  test("keeps an inactive conversation streaming and restores its live state", () => {
    let state = sessionReducer(undefined, { type: "test/init" });
    const sessionA = state.id;

    state = sessionReducer(
      state,
      submitEditorAndInitAtIndex({
        index: 0,
        editorState: EMPTY_EDITOR_STATE,
      }),
    );
    const controllerA = state.streamAborter;

    state = sessionReducer(state, newSession(savedSession("session-b", "B")));

    expect(controllerA.signal.aborted).toBe(false);
    expect(state.id).toBe("session-b");
    expect(state.backgroundSessionStates?.[sessionA]?.isStreaming).toBe(true);

    state = sessionReducer(
      state,
      scopeSessionAction(
        streamUpdate([{ role: "assistant", content: "A finished" }]),
        sessionA,
      ),
    );

    expect(state.history).toHaveLength(0);
    expect(
      state.backgroundSessionStates?.[sessionA]?.history.at(-1)?.message
        .content,
    ).toBe("A finished");

    state = sessionReducer(state, newSession(savedSession(sessionA, "A")));

    expect(state.id).toBe(sessionA);
    expect(state.isStreaming).toBe(true);
    expect(state.streamAborter).toBe(controllerA);
    expect(state.history.at(-1)?.message.content).toBe("A finished");
  });

  test("aborts only the explicitly targeted background conversation", () => {
    let state = sessionReducer(undefined, { type: "test/init" });
    const sessionA = state.id;

    state = sessionReducer(
      state,
      submitEditorAndInitAtIndex({
        index: 0,
        editorState: EMPTY_EDITOR_STATE,
      }),
    );
    const controllerA = state.streamAborter;
    state = sessionReducer(state, newSession(savedSession("session-b", "B")));
    const controllerB = state.streamAborter;

    state = sessionReducer(state, scopeSessionAction(abortStream(), sessionA));

    expect(controllerA.signal.aborted).toBe(true);
    expect(controllerB.signal.aborted).toBe(false);
    expect(state.id).toBe("session-b");
    expect(state.backgroundSessionStates?.[sessionA]?.streamAborter).not.toBe(
      controllerA,
    );
  });
});
