import { describe, expect, it } from "vitest";

import { toAgentsWindowOpenArguments } from "./agentsWindowHandoff";

describe("toAgentsWindowOpenArguments", () => {
  it("preserves the selected session in the native window arguments", () => {
    const resource = { scheme: "qivryn-agent", path: "/run-42" } as never;

    expect(toAgentsWindowOpenArguments(resource)).toEqual({
      sessionResource: resource,
    });
    expect(toAgentsWindowOpenArguments(undefined)).toBeUndefined();
  });
});
