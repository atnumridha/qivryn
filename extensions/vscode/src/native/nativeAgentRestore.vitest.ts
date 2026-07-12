import type { AgentRun } from "@qivryn/agent-runtime";
import { describe, expect, it } from "vitest";

import { selectNativeAgentRestoreRun } from "./nativeAgentRestore";

describe("selectNativeAgentRestoreRun", () => {
  it("restores the current or persisted non-archived run", () => {
    const runs = [run("newest"), run("persisted"), run("archived", true)];

    expect(
      selectNativeAgentRestoreRun(runs, ["missing", "persisted"])?.id,
    ).toBe("persisted");
  });

  it("falls back to the first available run and ignores archived runs", () => {
    const runs = [run("archived", true), run("available")];

    expect(selectNativeAgentRestoreRun(runs, ["archived"])?.id).toBe(
      "available",
    );
    expect(selectNativeAgentRestoreRun([run("archived", true)], [])).toBe(
      undefined,
    );
  });
});

function run(id: string, archived = false): AgentRun {
  return {
    id,
    revision: 0,
    title: id,
    prompt: id,
    status: archived ? "archived" : "completed",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace",
      location: "local",
      repositoryPath: "/workspace",
    },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    archived,
  };
}
