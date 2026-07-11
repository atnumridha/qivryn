import { describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { newSession, setActive } from "../slices/sessionSlice";
import { setupStore } from "../store";
import {
  isPlaceholderSessionTitle,
  loadSession,
  saveCurrentSession,
} from "./session";

describe("session titles", () => {
  it("recognizes legacy untitled-session placeholders", () => {
    expect(isPlaceholderSessionTitle("Untitled Session")).toBe(true);
    expect(isPlaceholderSessionTitle("New Session")).toBe(true);
    expect(isPlaceholderSessionTitle("Navigation fixes")).toBe(false);
  });

  it("replaces a legacy Untitled Session title when saving", async () => {
    const messenger = new MockIdeMessenger();
    const request = vi.spyOn(messenger, "request");
    const store = setupStore({ ideMessenger: messenger });
    store.dispatch(
      newSession({
        sessionId: "legacy-session",
        title: "Untitled Session",
        workspaceDirectory: "/workspace/app",
        history: [
          {
            message: {
              id: "user-message",
              role: "user",
              content: "Fix Agents navigation and session titles",
            },
            contextItems: [],
          },
          {
            message: {
              id: "assistant-message",
              role: "assistant",
              content: "I will fix both issues.",
            },
            contextItems: [],
          },
        ],
      } as any),
    );

    await store
      .dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      )
      .unwrap();

    expect(store.getState().session.title).toBe(
      "Fix Agents navigation and session titles",
    );
    expect(request).toHaveBeenCalledWith(
      "history/save",
      expect.objectContaining({
        sessionId: "legacy-session",
        title: "Fix Agents navigation and session titles",
      }),
    );
  });
});

describe("live session navigation", () => {
  it("restores a cached running session without reloading stale disk history", async () => {
    const messenger = new MockIdeMessenger();
    const request = vi.spyOn(messenger, "request");
    const store = setupStore({ ideMessenger: messenger });

    store.dispatch(
      newSession({
        sessionId: "session-a",
        title: "A",
        workspaceDirectory: "/workspace/app",
        history: [
          {
            message: {
              id: "assistant-a",
              role: "assistant",
              content: "still running",
            },
            contextItems: [],
          },
        ],
      } as any),
    );
    store.dispatch(setActive());
    const controllerA = store.getState().session.streamAborter;

    store.dispatch(
      newSession({
        sessionId: "session-b",
        title: "B",
        workspaceDirectory: "/workspace/app",
        history: [],
      } as any),
    );

    await store
      .dispatch(
        loadSession({ sessionId: "session-a", saveCurrentSession: false }),
      )
      .unwrap();

    expect(request).not.toHaveBeenCalledWith("history/load", {
      id: "session-a",
    });
    expect(store.getState().session.id).toBe("session-a");
    expect(store.getState().session.isStreaming).toBe(true);
    expect(store.getState().session.streamAborter).toBe(controllerA);
    expect(store.getState().session.history[0].message.content).toBe(
      "still running",
    );
  });
});
