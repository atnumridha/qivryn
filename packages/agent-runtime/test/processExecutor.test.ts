import { describe, expect, it } from "vitest";
import {
  AgentHookRunner,
  ProcessAgentExecutor,
  type AgentRun,
} from "../src/index.js";

function run(): AgentRun {
  return {
    id: "process-sandbox-metadata",
    revision: 0,
    title: "Sandbox metadata",
    prompt: "Inspect",
    status: "running",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    permissionMode: "readOnly",
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: process.cwd(),
    },
  };
}

describe("ProcessAgentExecutor sandbox metadata", () => {
  it("does not report sandbox enforcement for an injected Windows fallback", async () => {
    const events: Array<{ kind: string; payload: unknown }> = [];
    const executor = new ProcessAgentExecutor({
      progressIntervalMs: 0,
      resolveProcess: () => ({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        hostSandbox: {
          filesystem: "read-only",
          network: "allow",
          required: false,
        },
      }),
      hostSandboxResolver: (command) => ({
        command,
        applied: false,
        enforced: false,
        mechanism: "none",
        reason: "unsupported-platform",
      }),
    });

    await expect(
      executor.execute(run(), {
        signal: new AbortController().signal,
        emit: async (event) => {
          events.push({ kind: event.kind, payload: event.payload });
        },
      }),
    ).resolves.toEqual({ status: "completed" });

    expect(
      events.find((event) => event.kind === "tool.started")?.payload,
    ).toMatchObject({
      sandboxed: false,
      sandbox: {
        requested: true,
        applied: false,
        enforced: false,
        mechanism: "none",
        reason: "unsupported-platform",
      },
    });
  });

  it("does not start setup or the agent process when tool.before blocks", async () => {
    const events: Array<{ kind: string; payload: unknown }> = [];
    const executor = new ProcessAgentExecutor({
      progressIntervalMs: 0,
      hooks: new AgentHookRunner(
        async () => [
          {
            id: "tool-policy",
            event: "tool.before" as const,
            command: process.execPath,
            args: [
              "-e",
              "process.stderr.write('process denied');process.exit(2)",
            ],
            protocol: "codex" as const,
            sourceEvent: "PreToolUse" as const,
          },
        ],
        {
          hostSandboxResolver: (command) => ({
            command,
            applied: true,
            enforced: true,
            mechanism: "sandbox-exec",
          }),
        },
      ),
      resolveProcess: () => ({
        command: "main-process-must-not-start",
        setup: [{ command: "setup-must-not-start" }],
      }),
    });

    await expect(
      executor.execute(run(), {
        signal: new AbortController().signal,
        emit: async (event) => {
          events.push({ kind: event.kind, payload: event.payload });
        },
      }),
    ).resolves.toEqual({ status: "attention", reason: "process denied" });

    expect(events.some((event) => event.kind === "tool.started")).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.notice",
          payload: expect.objectContaining({
            type: "hook.result",
            result: expect.objectContaining({
              blocked: true,
              blockReason: "process denied",
            }),
          }),
        }),
      ]),
    );
  });

  it("records malformed tool hook configuration without blocking the process", async () => {
    const events: Array<{ kind: string; payload: unknown }> = [];
    const executor = new ProcessAgentExecutor({
      progressIntervalMs: 0,
      hooks: new AgentHookRunner(async () => {
        throw new Error("invalid hooks.json");
      }),
      resolveProcess: () => ({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      }),
    });

    await expect(
      executor.execute(run(), {
        signal: new AbortController().signal,
        emit: async (event) => {
          events.push({ kind: event.kind, payload: event.payload });
        },
      }),
    ).resolves.toEqual({ status: "completed" });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool.started" }),
        expect.objectContaining({
          kind: "runtime.notice",
          payload: expect.objectContaining({
            type: "hook.result",
            result: expect.objectContaining({
              hookId: "hook-configuration",
              status: "failed",
              stderr: expect.stringContaining("invalid hooks.json"),
            }),
          }),
        }),
      ]),
    );
  });
});
