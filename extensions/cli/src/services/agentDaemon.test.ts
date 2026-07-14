import { describe, expect, it } from "vitest";
import { dockerPrivilegedAuthorityFromEnv } from "./agentDaemon.js";

describe("agent daemon Docker privilege authority", () => {
  it("rejects privileged authority by default and for invalid values", () => {
    expect(dockerPrivilegedAuthorityFromEnv({})).toBeUndefined();
    expect(
      dockerPrivilegedAuthorityFromEnv({
        QIVRYN_ALLOW_PRIVILEGED_CONTAINERS: "false",
      }),
    ).toBeUndefined();
    expect(
      dockerPrivilegedAuthorityFromEnv({
        QIVRYN_ALLOW_PRIVILEGED_CONTAINERS: "metadata",
      }),
    ).toBeUndefined();
  });

  it.each(["1", "true", "YES", " on "])(
    "accepts the trusted daemon admin flag value %s",
    (value) => {
      expect(
        dockerPrivilegedAuthorityFromEnv({
          QIVRYN_ALLOW_PRIVILEGED_CONTAINERS: value,
        }),
      ).toEqual({ source: "admin-config", approved: true });
    },
  );
});
