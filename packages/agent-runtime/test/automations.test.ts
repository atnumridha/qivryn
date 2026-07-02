import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileAgentAutomationStore,
  runAgentAutomation,
} from "../src/automations.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

describe("agent automations", () => {
  it("persists an interval schedule and starts the same shared runtime", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "continue-automations-"),
    );
    roots.push(root);
    const store = new FileAgentAutomationStore(root);
    await store.initialize();
    const automation = await store.create({
      name: "Review nightly",
      prompt: "Review the working tree",
      repositoryPath: root,
      trigger: { type: "interval", everyMinutes: 30 },
    });
    expect(automation.nextRunAt).toBeTruthy();

    const createRun = vi.fn().mockResolvedValue({ id: "run-1" });
    const run = await runAgentAutomation(automation, { createRun } as never);
    expect(run.id).toBe("run-1");
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Review the working tree",
        metadata: { automationId: automation.id },
      }),
    );
  });
});
