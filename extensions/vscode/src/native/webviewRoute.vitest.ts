import { describe, expect, it } from "vitest";

import { normalizeQivrynWebviewRoute } from "./webviewRoute";

describe("normalizeQivrynWebviewRoute", () => {
  it("preserves agent workspace state in maximized mode", () => {
    expect(normalizeQivrynWebviewRoute("/agents")).toBe("/agents");
    expect(normalizeQivrynWebviewRoute("/agents?scheduled=1")).toBe(
      "/agents?scheduled=1",
    );
    expect(normalizeQivrynWebviewRoute("/agents?runId=active-run")).toBe(
      "/agents?runId=active-run",
    );
  });

  it("preserves supported routes and falls back from unknown paths", () => {
    expect(normalizeQivrynWebviewRoute("/browser?runId=browser-run")).toBe(
      "/browser?runId=browser-run",
    );
    expect(normalizeQivrynWebviewRoute("/config?tab=extensions")).toBe(
      "/config?tab=extensions",
    );
    expect(normalizeQivrynWebviewRoute("/not-a-qivryn-route")).toBe("/");
    expect(normalizeQivrynWebviewRoute(undefined)).toBeUndefined();
  });
});
