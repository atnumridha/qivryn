import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AgentHookError,
  AgentHookRunner,
  FileAgentHookRegistry,
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
          "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(process.env.QIVRYN_HOOK_EVENT+' '+JSON.parse(s).run.id))",
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

  it("loads Codex hook groups and returns additional context", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "qivryn-codex-hooks-"),
    );
    const filepath = path.join(root, "hooks.json");
    await fs.writeFile(
      filepath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{let p=JSON.parse(s);process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'verified '+p.prompt}}))})")}`,
                  timeout: 5,
                },
              ],
            },
          ],
        },
      }),
    );
    const registry = new FileAgentHookRegistry(filepath);
    const runner = new AgentHookRunner(() => registry.list());
    const [result] = await runner.run("agent.before", {
      run: {
        id: "run-1",
        prompt: "request",
        permissionMode: "autonomous",
        workspace: { repositoryPath: root },
      },
    });
    expect(result).toMatchObject({
      status: "completed",
      additionalContext: "verified request",
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps imported Codex hooks inert until they are enabled", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "qivryn-codex-hooks-disabled-"),
    );
    const filepath = path.join(root, "hooks.json");
    await fs.writeFile(
      filepath,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.stdout.write('unexpected')")}`,
                  enabled: false,
                },
              ],
            },
          ],
        },
      }),
    );
    const registry = new FileAgentHookRegistry(filepath);
    const runner = new AgentHookRunner(() => registry.list());
    expect(await runner.run("agent.after", { run: { id: "run-1" } })).toEqual(
      [],
    );
    await fs.rm(root, { recursive: true, force: true });
  });
});
