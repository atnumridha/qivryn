import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelActiveApply } from "./cancelActiveApply";

vi.mock("./cancelStream", () => ({
  cancelStream: vi.fn(() => ({ type: "chat/cancelStream" })),
}));

describe("cancelActiveApply", () => {
  const dispatch = vi.fn();
  const post = vi.fn();
  const extra = { ideMessenger: { post } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels the tool, targets the active diff, and closes the apply UI", async () => {
    const getState = vi.fn(() => ({
      session: {
        history: [],
        codeBlockApplyStates: {
          states: [
            {
              streamId: "stream-1",
              toolCallId: "tool-1",
              filepath: "/workspace/app.ts",
              status: "streaming",
              numDiffs: 2,
            },
          ],
        },
      },
      editModeState: {
        applyState: { streamId: "edit", status: "not-started" },
        codeToEdit: [],
      },
    }));

    await cancelActiveApply()(dispatch, getState as any, extra);

    expect(post).toHaveBeenCalledWith("rejectDiff", {
      filepath: "/workspace/app.ts",
      streamId: "stream-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "session/cancelToolCall",
      payload: { toolCallId: "tool-1" },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session/updateApplyState",
        payload: expect.objectContaining({
          streamId: "stream-1",
          status: "closed",
          numDiffs: 0,
        }),
      }),
    );
  });

  it("still sends an abort escape hatch for legacy state", async () => {
    const getState = vi.fn(() => ({
      session: {
        history: [],
        codeBlockApplyStates: { states: [] },
      },
      editModeState: {
        applyState: { streamId: "edit", status: "not-started" },
        codeToEdit: [],
      },
    }));

    await cancelActiveApply()(dispatch, getState as any, extra);

    expect(post).toHaveBeenCalledWith("rejectDiff", {});
  });
});
