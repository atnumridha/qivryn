import { describe, expect, it } from "vitest";
import {
  isNewerRelease,
  nextReleaseUpdateRetryDelay,
  releaseVersionFromTag,
} from "./releaseUpdatePolicy";

describe("release update policy", () => {
  it("parses Qivryn IDE release tags", () => {
    expect(releaseVersionFromTag("v1.3.43-qivryn-ide")).toBe("1.3.43");
    expect(releaseVersionFromTag("1.3.43")).toBe("1.3.43");
    expect(releaseVersionFromTag("latest")).toBeUndefined();
  });

  it("compares semantic release versions", () => {
    expect(isNewerRelease("1.3.42", "1.3.43")).toBe(true);
    expect(isNewerRelease("1.3.42", "1.4.0")).toBe(true);
    expect(isNewerRelease("1.3.42", "2.0.0")).toBe(true);
    expect(isNewerRelease("1.3.42", "1.3.42")).toBe(false);
    expect(isNewerRelease("1.3.42", "1.3.41")).toBe(false);
    expect(isNewerRelease("invalid", "1.3.43")).toBe(false);
  });

  it("uses a bounded retry schedule", () => {
    expect(nextReleaseUpdateRetryDelay(0)).toBe(1_000);
    expect(nextReleaseUpdateRetryDelay(2)).toBe(7_000);
    expect(nextReleaseUpdateRetryDelay(3)).toBeUndefined();
  });
});
