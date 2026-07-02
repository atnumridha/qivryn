import { describe, expect, it } from "vitest";
import type { AgentRun } from "@qivryn/agent-runtime";
import {
  agentNotificationMessage,
  shouldNotifyAgent,
} from "./agentNotificationPolicy";

const run = {
  id: "run-1",
  revision: 0,
  title: "Private customer migration",
  prompt: "secret",
  status: "completed",
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:01.000Z",
  permissionMode: "autonomous",
  workspace: {
    id: "workspace-1",
    location: "local",
    repositoryPath: "/private/repository",
  },
} satisfies AgentRun;

describe("agent notification policy", () => {
  it("supports off, background-only, and always modes", () => {
    expect(shouldNotifyAgent("off", false)).toBe(false);
    expect(shouldNotifyAgent("whenUnfocused", true)).toBe(false);
    expect(shouldNotifyAgent("whenUnfocused", false)).toBe(true);
    expect(shouldNotifyAgent("always", true)).toBe(true);
  });

  it("does not expose task or repository details by default", () => {
    expect(agentNotificationMessage(run, false)).toBe("Qivryn agent completed");
    expect(agentNotificationMessage(run, false)).not.toContain(run.title);
    expect(agentNotificationMessage(run, true)).toContain(run.title);
  });
});
