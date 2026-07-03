import { describe, expect, test } from "vitest";
import OracleCodeAssist from "./OracleCodeAssist.js";

class TestableOracleCodeAssist extends OracleCodeAssist {
  getHeadersForTest() {
    return this._getHeaders();
  }
}

describe("OracleCodeAssist", () => {
  test("does not require OCA credentials while loading the config", () => {
    expect(
      () =>
        new OracleCodeAssist({
          model: "oca/gpt-5.3-codex",
        }),
    ).not.toThrow();
  });

  test("uses an explicit credential when an OCA request is prepared", () => {
    const oca = new TestableOracleCodeAssist({
      model: "oca/gpt-5.3-codex",
      apiKey: "configured-oca-token",
    });

    expect(oca.getHeadersForTest()).toMatchObject({
      Authorization: "Bearer configured-oca-token",
      "api-key": "configured-oca-token",
      client: "Qivryn",
      "client-ide": "vscode",
    });
  });
});
