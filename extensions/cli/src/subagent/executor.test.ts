import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import { services } from "../services/index.js";

import { executeSubAgent } from "./executor.js";

const observedHistories: Array<{
  prompt: string;
  service: unknown;
  permissionService: unknown;
  permissionState: any;
  model: any;
  systemMessage: string;
}> = [];

vi.mock("../stream/streamChatResponse.js", () => ({
  streamChatResponse: vi.fn(async (history: any[], model: any) => {
    const { services: scopedServices } = await import("../services/index.js");
    const prompt = String(history[0]?.message?.content ?? "");
    const permissionState = scopedServices.toolPermissions.getState();
    observedHistories.push({
      prompt,
      service: scopedServices.chatHistory,
      permissionService: scopedServices.toolPermissions,
      permissionState,
      model,
      systemMessage: await scopedServices.systemMessage.getSystemMessage(
        permissionState.currentMode,
      ),
    });
    await new Promise((resolve) =>
      setTimeout(resolve, prompt === "first" ? 10 : 1),
    );
    scopedServices.chatHistory.addAssistantMessage(`done:${prompt}`);
    return `done:${prompt}`;
  }),
}));

describe("executeSubAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    observedHistories.length = 0;
    vi.spyOn(services.systemMessage, "getSystemMessage").mockResolvedValue(
      "parent system",
    );
  });

  it("isolates concurrent child histories without replacing parent permissions", async () => {
    const parentHistory = services.chatHistory;
    const parentPermissions = services.toolPermissions;
    const agent = {
      model: {
        name: "child-model",
        chatOptions: { baseSystemMessage: "child system" },
      },
      llmApi: {},
    } as any;

    const [first, second] = await Promise.all(
      ["first", "second"].map((prompt) =>
        executeSubAgent({
          agent,
          prompt,
          parentSessionId: "parent-run",
          abortController: new AbortController(),
        }),
      ),
    );

    expect(first).toMatchObject({ success: true, response: "done:first" });
    expect(second).toMatchObject({ success: true, response: "done:second" });
    expect(observedHistories.map(({ prompt }) => prompt).sort()).toEqual([
      "first",
      "second",
    ]);
    expect(new Set(observedHistories.map(({ service }) => service)).size).toBe(
      2,
    );
    expect(services.chatHistory).toBe(parentHistory);
    expect(services.toolPermissions).toBe(parentPermissions);
  });

  it("applies readonly and tool scopes without escalating parent permissions", async () => {
    const parentPermissions = services.toolPermissions;
    vi.spyOn(parentPermissions, "getState").mockReturnValue({
      permissions: {
        policies: [
          { tool: "Read", permission: "exclude" },
          { tool: "*", permission: "allow" },
        ],
      },
      currentMode: "normal",
      isHeadless: false,
      modePolicyCount: 0,
    });
    const agent = {
      model: {
        name: "reviewer",
        provider: "test",
        model: "selected-model-id",
        chatOptions: { baseSystemMessage: "Review only" },
        portableSubagent: {
          name: "reviewer",
          prompt: "Review only",
          tools: ["Read", "Search", "Bash"],
          permissionMode: "readonly",
          background: false,
          sourceFile: "/tmp/reviewer.md",
        },
      },
      llmApi: {},
    } as any;

    const result = await executeSubAgent({
      agent,
      prompt: "inspect",
      parentSessionId: "parent-run",
      abortController: new AbortController(),
    });

    expect(result).toMatchObject({ success: true, response: "done:inspect" });
    const observed = observedHistories[0];
    expect(observed.model.model).toBe("selected-model-id");
    expect(observed.permissionService).not.toBe(parentPermissions);
    expect(observed.permissionState.currentMode).toBe("sandbox");
    expect(
      checkToolPermission(
        { name: "Read", arguments: {} },
        observed.permissionState.permissions,
      ).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(
        { name: "Search", arguments: {} },
        observed.permissionState.permissions,
      ).permission,
    ).toBe("allow");
    expect(
      checkToolPermission(
        { name: "Bash", arguments: {} },
        observed.permissionState.permissions,
      ).permission,
    ).toBe("exclude");
    expect(
      checkToolPermission(
        { name: "Write", arguments: {} },
        observed.permissionState.permissions,
      ).permission,
    ).toBe("exclude");
    expect(observed.systemMessage).toContain("Review only");
    expect(services.toolPermissions).toBe(parentPermissions);
  });
});
