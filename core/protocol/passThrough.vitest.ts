import { describe, expect, it } from "vitest";

import { WEBVIEW_TO_CORE_PASS_THROUGH } from "./passThrough";

describe("webview to core pass-through", () => {
  it("routes every Codex import request used by the settings UI", () => {
    expect(WEBVIEW_TO_CORE_PASS_THROUGH).toEqual(
      expect.arrayContaining([
        "extensions/codexImportPreview",
        "extensions/codexImportApply",
        "extensions/codexImportSetEnabled",
      ]),
    );
  });
});
