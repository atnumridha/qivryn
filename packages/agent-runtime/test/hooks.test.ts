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

  it("normalizes Codex exit 2 and PreToolUse deny output as blockers", async () => {
    const exitBlock = new AgentHookRunner(async () => [
      {
        id: "exit-block",
        event: "agent.before" as const,
        command: process.execPath,
        args: [
          "-e",
          "process.stderr.write('submission denied');process.exit(2)",
        ],
        protocol: "codex" as const,
        sourceEvent: "UserPromptSubmit" as const,
      },
    ]);
    await expect(exitBlock.run("agent.before", {})).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        exitCode: 2,
        blocked: true,
        blockReason: "submission denied",
      }),
    ]);

    const permissionBlock = new AgentHookRunner(async () => [
      {
        id: "permission-block",
        event: "tool.before" as const,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: "command denied",
              },
            }),
          )})`,
        ],
        protocol: "codex" as const,
        sourceEvent: "PreToolUse" as const,
      },
    ]);
    await expect(permissionBlock.run("tool.before", {})).resolves.toEqual([
      expect.objectContaining({
        status: "completed",
        blocked: true,
        blockReason: "command denied",
      }),
    ]);
  });

  it("returns an error result when hook configuration cannot be read", async () => {
    const runner = new AgentHookRunner(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    await expect(runner.run("agent.before", {})).resolves.toEqual([
      expect.objectContaining({
        hookId: "hook-configuration",
        event: "agent.before",
        status: "failed",
        stdout: "",
        stderr: "Hook configuration could not be loaded: permission denied",
      }),
    ]);
  });

  it("runs read-only hooks through the injected run sandbox boundary", async () => {
    const hostSandboxResolver = vi.fn((command) => ({
      command,
      applied: true,
      enforced: true,
      mechanism: "bwrap" as const,
    }));
    const runner = new AgentHookRunner(
      async () => [
        {
          id: "sandboxed",
          event: "tool.before" as const,
          command: process.execPath,
          args: ["-e", "process.stdout.write('sandboxed')"],
        },
      ],
      { hostSandboxResolver },
    );

    const [result] = await runner.run("tool.before", {
      run: {
        permissionMode: "readOnly",
        workspace: { repositoryPath: process.cwd() },
      },
      spec: {
        hostSandbox: {
          filesystem: "read-only",
          network: "deny",
          required: false,
        },
      },
    });

    expect(hostSandboxResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        command: process.execPath,
        cwd: process.cwd(),
      }),
      { filesystem: "read-only", network: "deny", required: false },
    );
    expect(result).toMatchObject({
      status: "completed",
      stdout: "sandboxed",
      sandbox: { applied: true, enforced: true, mechanism: "bwrap" },
    });
  });

  it("skips untrusted read-only hooks when sandbox enforcement is unavailable", async () => {
    const runner = new AgentHookRunner(
      async () => [
        {
          id: "untrusted",
          event: "agent.before" as const,
          command: process.execPath,
          args: ["-e", "process.stdout.write('unexpected')"],
        },
      ],
      {
        hostSandboxResolver: (command) => ({
          command,
          applied: false,
          enforced: false,
          mechanism: "none",
          reason: "unsupported-platform",
        }),
      },
    );

    const [result] = await runner.run("agent.before", {
      run: {
        permissionMode: "readOnly",
        workspace: { repositoryPath: process.cwd() },
      },
    });

    expect(result).toMatchObject({
      status: "skipped",
      stdout: "",
      sandbox: {
        applied: false,
        enforced: false,
        mechanism: "none",
        reason: "unsupported-platform",
      },
    });
    expect(result.stderr).toContain("trusted=true");
  });

  it("only runs an unenforced read-only hook when it is explicitly trusted", async () => {
    const runner = new AgentHookRunner(
      async () => [
        {
          id: "trusted",
          event: "agent.before" as const,
          command: process.execPath,
          args: ["-e", "process.stdout.write('reviewed')"],
          trusted: true,
        },
      ],
      {
        hostSandboxResolver: (command) => ({
          command,
          applied: false,
          enforced: false,
          mechanism: "none",
          reason: "unsupported-platform",
        }),
      },
    );

    const [result] = await runner.run("agent.before", {
      run: {
        permissionMode: "readOnly",
        workspace: { repositoryPath: process.cwd() },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      stdout: "reviewed",
      trustedUnsandboxed: true,
      sandbox: { applied: false, enforced: false, mechanism: "none" },
    });
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

  it("stops an agent run when an agent.before hook blocks it", async () => {
    const hooks = new AgentHookRunner(async () => [
      {
        id: "prompt-policy",
        event: "agent.before" as const,
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(
            JSON.stringify({
              decision: "block",
              reason: "prompt rejected by policy",
            }),
          )})`,
        ],
        protocol: "codex" as const,
        sourceEvent: "UserPromptSubmit" as const,
      },
    ]);
    const execute = vi.fn(async () => ({ status: "completed" as const }));
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute },
      { prepare: async (run) => run.workspace },
      { hooks },
    );
    await runtime.initialize();
    const run = await runtime.createRun({
      prompt: "Rejected prompt",
      workspace: { location: "local", repositoryPath: process.cwd() },
    });
    await runtime.waitForIdle();

    expect(execute).not.toHaveBeenCalled();
    await expect(runtime.getRun(run.id)).resolves.toMatchObject({
      status: "attention",
      statusReason: "prompt rejected by policy",
      unread: true,
    });
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

  it("loads a plain Codex event-map object", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "qivryn-codex-hooks-event-map-"),
    );
    const filepath = path.join(root, "hooks.json");
    await fs.writeFile(
      filepath,
      JSON.stringify({
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: JSON.stringify(process.execPath),
                enabled: false,
              },
            ],
          },
        ],
      }),
    );

    try {
      await expect(new FileAgentHookRegistry(filepath).list()).resolves.toEqual(
        [
          expect.objectContaining({
            event: "agent.before",
            command: process.execPath,
            enabled: false,
            protocol: "codex",
            sourceEvent: "UserPromptSubmit",
          }),
        ],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("records malformed hook configuration and continues the agent executor", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "qivryn-codex-hooks-malformed-"),
    );
    const filepath = path.join(root, "hooks.json");
    await fs.writeFile(
      filepath,
      JSON.stringify({ UserPromptSubmit: { hooks: [] } }),
    );
    const hooks = new AgentHookRunner(() =>
      new FileAgentHookRegistry(filepath).list(),
    );
    const execute = vi.fn(async () => ({ status: "completed" as const }));
    const runtime = new LocalAgentRuntime(
      new MemoryAgentStore(),
      { execute },
      { prepare: async (run) => run.workspace },
      { hooks },
    );

    try {
      await runtime.initialize();
      const run = await runtime.createRun({
        prompt: "Continue despite malformed hooks",
        permissionMode: "autonomous",
        workspace: { location: "local", repositoryPath: root },
      });
      await runtime.waitForIdle();

      expect(execute).toHaveBeenCalledTimes(1);
      await expect(runtime.getRun(run.id)).resolves.toMatchObject({
        status: "completed",
      });
      expect(await runtime.readEvents(run.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime.notice",
            payload: expect.objectContaining({
              type: "hook.result",
              result: expect.objectContaining({
                hookId: "hook-configuration",
                status: "failed",
                stderr: expect.stringContaining(
                  "Codex hook event UserPromptSubmit must be an array",
                ),
              }),
            }),
          }),
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves quoted Windows drive and UNC backslashes in imported hooks", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "qivryn-codex-hooks-windows-"),
    );
    const filepath = path.join(root, "hooks.json");
    const command = String.raw`"C:\Program Files\Qivryn\hook.exe" "--config=C:\Users\Atanu\hook.json" "\\server\share\input.json"`;
    await fs.writeFile(
      filepath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command, timeout: 5 }] },
          ],
        },
      }),
    );

    try {
      const [hook] = await new FileAgentHookRegistry(filepath).list();
      expect(hook).toMatchObject({
        command: String.raw`C:\Program Files\Qivryn\hook.exe`,
        args: [
          String.raw`--config=C:\Users\Atanu\hook.json`,
          String.raw`\\server\share\input.json`,
        ],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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
