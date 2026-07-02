import { describe, expect, it } from "vitest";
import type { AgentRun } from "@qivryn/agent-runtime";
import { worktreeDecorationForFile } from "./worktreeDecorationPolicy";

function run(id: string, root: string, branch: string): AgentRun {
  return {
    id,
    revision: 0,
    title: `Agent ${id}`,
    prompt: "task",
    status: "running",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    permissionMode: "autonomous",
    workspace: {
      id: `workspace-${id}`,
      location: "local",
      repositoryPath: "/repo",
      worktreePath: root,
      branch,
    },
  };
}

describe("worktree tab decoration", () => {
  it("uses the deepest matching agent worktree and exposes its branch", () => {
    const result = worktreeDecorationForFile(
      "/repo/.qivryn/worktrees/agent-a/packages/app/src/index.ts",
      [
        run("parent", "/repo/.qivryn/worktrees/agent-a", "codex/parent"),
        run(
          "nested",
          "/repo/.qivryn/worktrees/agent-a/packages/app",
          "codex/nested",
        ),
      ],
    );
    expect(result).toMatchObject({
      runId: "nested",
      branch: "codex/nested",
      title: "Agent nested",
    });
  });

  it("does not decorate files outside an agent worktree", () => {
    expect(
      worktreeDecorationForFile("/repo/src/index.ts", [
        run("agent", "/repo/.qivryn/worktrees/agent", "codex/agent"),
      ]),
    ).toBeUndefined();
  });
});
