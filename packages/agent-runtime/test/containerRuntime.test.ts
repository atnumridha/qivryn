import { describe, expect, it } from "vitest";
import {
  buildDockerRunSpec,
  createDockerAgentRuntime,
  MemoryAgentStore,
  type AgentRun,
} from "../src/index.js";

function run(permissionMode: AgentRun["permissionMode"]): AgentRun {
  return {
    id: "run/docker:1",
    revision: 0,
    title: "Container agent",
    prompt: "Run tests",
    status: "queued",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:00.000Z",
    permissionMode,
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: "/workspace/repo",
      worktreePath: "/workspace/worktrees/agent-1",
    },
  };
}

describe("Docker container runtime", () => {
  it("maps read-only mode to a read-only mount and no network", () => {
    const spec = buildDockerRunSpec(run("readOnly"), {
      image: "continue-agent:latest",
      command: "cn",
      args: ["-p", "inspect"],
    });
    expect(spec.command).toBe("docker");
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "/workspace/worktrees/agent-1:/workspace:ro",
        "none",
        "CONTINUE_PERMISSION_MODE=readOnly",
      ]),
    );
  });

  it("adds explicit read-only attachment mounts", () => {
    const spec = buildDockerRunSpec(run("autonomous"), {
      image: "continue-agent:latest",
      command: "cn",
      mounts: [
        {
          source: "/tmp/screen shot.png",
          target: "/continue-attachments/image-1",
          readOnly: true,
        },
      ],
    });
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "--mount",
        "type=bind,source=/tmp/screen shot.png,target=/continue-attachments/image-1,readonly",
      ]),
    );
  });

  it("rejects relative attachment mount targets", () => {
    expect(() =>
      buildDockerRunSpec(run("autonomous"), {
        image: "continue-agent:latest",
        command: "cn",
        mounts: [{ source: "/tmp/image.png", target: "attachments/image-1" }],
      }),
    ).toThrow("absolute paths");
  });

  it("keeps autonomous agents writable without granting privilege", () => {
    const spec = buildDockerRunSpec(run("autonomous"), {
      image: "continue-agent:latest",
      command: "cn",
      network: "continue-dev",
      env: { CI: "1" },
    });
    expect(spec.args).toContain("/workspace/worktrees/agent-1:/workspace");
    expect(spec.args).toContain("continue-dev");
    expect(spec.args).not.toContain("--privileged");
  });

  it("requires explicit authority for privileged containers", () => {
    expect(() =>
      buildDockerRunSpec(run("fullAccess"), {
        image: "continue-agent:latest",
        command: "cn",
        privileged: true,
      }),
    ).toThrow(/allowPrivileged/);
    expect(
      buildDockerRunSpec(
        run("fullAccess"),
        { image: "continue-agent:latest", command: "cn", privileged: true },
        { allowPrivileged: true },
      ).args,
    ).toContain("--privileged");
  });

  it("uses the complete shared runtime contract with container capabilities", () => {
    const runtime = createDockerAgentRuntime(
      new MemoryAgentStore(),
      { prepare: async (agentRun) => agentRun.workspace },
      {
        resolveContainer: () => ({
          image: "continue-agent:latest",
          command: "cn",
        }),
      },
    );
    expect(runtime.capabilities).toMatchObject({
      local: false,
      remote: true,
      persistent: true,
      worktrees: true,
      checkpoints: true,
    });
  });
});
