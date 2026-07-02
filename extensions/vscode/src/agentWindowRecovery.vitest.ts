import { describe, expect, it, vi } from "vitest";
import {
  recoverClosedAgentWindow,
  releaseAgentWindowEditState,
} from "./agentWindowRecovery";

describe("releaseAgentWindowEditState", () => {
  it("cancels and unlocks an active file before a standalone reload", async () => {
    const order: string[] = [];
    await releaseAgentWindowEditState({
      cancelApply: async () => {
        order.push("cancel");
      },
      getCurrentFile: async () => ({ path: "file:///workspace/app.ts" }),
      getStreamId: () => "stream-1",
      clearDiff: () => order.push("clear"),
    });

    expect(order).toEqual(["cancel", "clear"]);
  });
});

describe("recoverClosedAgentWindow", () => {
  it("cancels an active apply, releases its diff, and restores the session", async () => {
    const order: string[] = [];
    const clearDiff = vi.fn(() => order.push("clear"));
    await recoverClosedAgentWindow({
      cancelApply: async () => {
        order.push("cancel");
      },
      getCurrentFile: async () => ({ path: "file:///workspace/app.ts" }),
      getStreamId: () => "stream-1",
      clearDiff,
      restoreSession: async () => {
        order.push("restore");
      },
    });

    expect(clearDiff).toHaveBeenCalledWith("file:///workspace/app.ts");
    expect(order).toEqual(["cancel", "clear", "restore"]);
  });

  it("restores the session even when no diff is active", async () => {
    const restoreSession = vi.fn(async () => undefined);
    const clearDiff = vi.fn();
    await recoverClosedAgentWindow({
      cancelApply: async () => undefined,
      getCurrentFile: async () => undefined,
      getStreamId: () => undefined,
      clearDiff,
      restoreSession,
    });

    expect(clearDiff).not.toHaveBeenCalled();
    expect(restoreSession).toHaveBeenCalledOnce();
  });
});
