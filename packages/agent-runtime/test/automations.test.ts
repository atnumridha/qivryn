import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileAgentAutomationStore,
  nextAgentAutomationRun,
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
      path.join(os.tmpdir(), "qivryn-automations-"),
    );
    roots.push(root);
    const store = new FileAgentAutomationStore(root);
    await store.initialize();
    const automation = await store.create({
      name: "Review nightly",
      prompt: "Review the working tree",
      repositoryPath: root,
      trigger: { type: "interval", everyMinutes: 30 },
      model: "gpt-test",
      reasoningEffort: "high",
    });
    expect(automation.nextRunAt).toBeTruthy();

    const createRun = vi.fn().mockResolvedValue({ id: "run-1" });
    const run = await runAgentAutomation(automation, { createRun } as never);
    expect(run.id).toBe("run-1");
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Review the working tree",
        model: "gpt-test",
        metadata: { automationId: automation.id, reasoningEffort: "high" },
      }),
    );

    const updated = await store.updateAutomation(automation.id, {
      name: "Review every morning",
      prompt: "Review the repository and summarize findings",
      trigger: { type: "daily", at: "09:30" },
      permissionMode: "ask",
    });
    expect(updated).toMatchObject({
      revision: 2,
      name: "Review every morning",
      prompt: "Review the repository and summarize findings",
      trigger: { type: "daily", at: "09:30" },
      permissionMode: "ask",
    });
    expect(updated.nextRunAt).toBeTruthy();
  });

  it("calculates daily and weekly schedules in the host local timezone", () => {
    const from = new Date(2026, 6, 11, 9, 30, 0, 0);

    const laterToday = new Date(
      nextAgentAutomationRun({ type: "daily", at: "10:15" }, from)!,
    );
    expect([laterToday.getHours(), laterToday.getMinutes()]).toEqual([10, 15]);

    const tomorrow = new Date(2026, 6, 12, 7, 45, 0, 0);
    expect(
      new Date(nextAgentAutomationRun({ type: "daily", at: "07:45" }, from)!),
    ).toEqual(tomorrow);

    const monday = new Date(2026, 6, 13, 8, 30, 0, 0);
    expect(
      new Date(
        nextAgentAutomationRun(
          { type: "weekly", at: "08:30", daysOfWeek: [1, 3] },
          from,
        )!,
      ),
    ).toEqual(monday);
  });

  it("preserves Codex RRULE schedules", () => {
    const from = new Date(2026, 6, 11, 9, 56, 30, 0);
    const hourly = new Date(
      nextAgentAutomationRun(
        { type: "rrule", rrule: "RRULE:FREQ=HOURLY;BYMINUTE=0" },
        from,
      )!,
    );
    expect([hourly.getHours(), hourly.getMinutes()]).toEqual([10, 0]);

    const weekend = new Date(
      nextAgentAutomationRun(
        {
          type: "rrule",
          rrule: "FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=7",
        },
        from,
      )!,
    );
    expect([
      weekend.getDay(),
      weekend.getHours(),
      weekend.getMinutes(),
    ]).toEqual([6, 10, 7]);
  });

  it("rejects invalid schedule values", () => {
    const now = new Date();
    expect(() =>
      nextAgentAutomationRun({ type: "daily", at: "25:00" }, now),
    ).toThrow(/valid local time/);
    expect(() =>
      nextAgentAutomationRun(
        { type: "weekly", at: "09:00", daysOfWeek: [] },
        now,
      ),
    ).toThrow(/at least one weekday/);
  });
});
