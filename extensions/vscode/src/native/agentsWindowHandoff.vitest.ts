import { describe, expect, it } from "vitest";

import {
  toAgentsWebviewRoute,
  toAgentsWindowOpenArguments,
} from "./agentsWindowHandoff";

describe("toAgentsWindowOpenArguments", () => {
  it("preserves the selected session in the native window arguments", () => {
    const resource = { scheme: "qivryn-agent", path: "/run-42" } as never;

    expect(toAgentsWindowOpenArguments(resource)).toEqual({
      sessionResource: resource,
    });
    expect(toAgentsWindowOpenArguments(undefined)).toBeUndefined();
  });

  it("routes the Qivryn toolbar to the unified composer", () => {
    const resource = {
      path: "/run%20with%20spaces",
    } as never;

    expect(toAgentsWebviewRoute(resource)).toBe(
      "/?agentRunId=run%20with%20spaces",
    );
    expect(toAgentsWebviewRoute(undefined)).toBe("/");
  });
});
