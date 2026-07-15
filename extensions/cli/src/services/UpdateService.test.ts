import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateStatus } from "./types.js";

vi.mock("../version.js", () => ({
  compareVersions: vi.fn(),
  getLatestVersion: vi.fn(),
  getVersion: vi.fn(() => "0.0.0-dev"),
}));

vi.mock("./ServiceContainer.js", () => ({
  serviceContainer: { set: vi.fn() },
}));

const { UpdateService } = await import("./UpdateService.js");

describe("UpdateService development builds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports why a development build cannot self-update", async () => {
    const service = new UpdateService();

    await service.performUpdate(false);

    expect(service.getState()).toMatchObject({
      status: UpdateStatus.ERROR,
      message:
        "This is a development build. Rebuild and reinstall it from the Qivryn repository.",
      isUpdateAvailable: false,
      currentVersion: "0.0.0-dev",
    });
    expect(service.getState().error?.message).toBe(
      "Development builds cannot self-update",
    );
  });
});
