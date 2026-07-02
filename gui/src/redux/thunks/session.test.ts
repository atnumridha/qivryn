import { describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { newSession } from "../slices/sessionSlice";
import { setupStore } from "../store";
import { isPlaceholderSessionTitle, saveCurrentSession } from "./session";

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
