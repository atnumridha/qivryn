import { describe, expect, it, vi } from "vitest";
import {
  AgentHookError,
  AgentHookRunner,
  LocalAgentRuntime,
  MemoryAgentStore,
  type AgentHookExecutor,
} from "../src/index.js";

describe("shared lifecycle hooks", () => {
  it("passes JSON payloads on stdin with a stable event environment", async () => {
    const runner = new AgentHookRunner(async () => [
      {
        id: "capture-before",
        event: "agent.before",
        command: process.execPath,
        args: [
          "-e",
          "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(process.env.CONTINUE_HOOK_EVENT+' '+JSON.parse(s).run.id))",
        ],
        failurePolicy: "error",
      },
    ]);
    const [result] = await runner.run("agent.before", { run: { id: "run-1" } });
    expect(result).toMatchObject({
      hookId: "capture-before",
      event: "agent.before",
      status: "completed",
      stdout: "agent.before run-1",
    });
  });

  it("supports warning and blocking failure policies", async () => {
    const warn = new AgentHookRunner(async () => [
      {
        id: "warn",
        event: "review.before",
        command: process.execPath,
        args: ["-e", "process.exit(3)"],
        failurePolicy: "warn",
      },
    ]);
    expect((await warn.run("review.before", {}))[0].status).toBe("failed");
    const block = new AgentHookRunner(async () => [
      {
        id: "block",
        event: "edit.before",
        command: process.execPath,
        args: ["-e", "process.exit(4)"],
        failurePolicy: "error",
      },
    ]);
    await expect(block.run("edit.before", {})).rejects.toBeInstanceOf(
      AgentHookError,
    );
  });

  it("executes the same before/after schema around agent runs", async () => {
    const hooks: AgentHookExecutor = { run: vi.fn(async () => []) };
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute: async () => ({ status: "completed" }) },
      { prepare: async (run) => run.workspace },
      { hooks },
    );
    await runtime.initialize();
    await runtime.createRun({
      prompt: "Hooked run",
      permissionMode: "autonomous",
      workspace: { location: "local", repositoryPath: "/workspace" },
    });
    await runtime.waitForIdle();
    expect(hooks.run).toHaveBeenNthCalledWith(
      1,
      "agent.before",
      expect.objectContaining({
        run: expect.objectContaining({ status: "running" }),
      }),
    );
    expect(hooks.run).toHaveBeenLastCalledWith(
      "agent.after",
      expect.objectContaining({
        run: expect.objectContaining({ status: "completed" }),
      }),
    );
  });
});
