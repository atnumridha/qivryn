import { describe, expect, it } from "vitest";
import type { AgentRun } from "@qivryn/agent-runtime";
import { activeAgentScmEntries, activeAgentWorktrees } from "./agentScmPolicy";

function run(id: string, worktreePath?: string, archived = false): AgentRun {
  return {
    id,
    revision: 0,
    title: id,
    prompt: "task",
    status: archived ? "archived" : "running",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    permissionMode: "autonomous",
    archived,
    workspace: {
      id: `workspace-${id}`,
      location: "local",
      repositoryPath: "/repo",
      worktreePath,
      branch: `qivryn/agent-${id}`,
    },
  };
}

describe("agent SCM graph registration", () => {
  it("returns unique active worktrees and excludes archived runs", () => {
    expect(
      activeAgentWorktrees([
        run("a", "/repo/worktrees/a"),
        run("a-copy", "/repo/worktrees/a"),
        run("b", "/repo/worktrees/b"),
        run("archived", "/repo/worktrees/old", true),
        run("draft"),
      ]),
    ).toEqual(["/repo/worktrees/a", "/repo/worktrees/b"]);
  });

  it("publishes native tab and graph identity for each active worktree", () => {
    expect(
      activeAgentScmEntries([
        run("auth", "/repo/worktrees/auth"),
        run("archived", "/repo/worktrees/old", true),
      ]),
    ).toEqual([
      {
        root: "/repo/worktrees/auth",
        repository: "repo",
        branch: "qivryn/agent-auth",
        runId: "auth",
        title: "auth",
      },
    ]);
  });
});
