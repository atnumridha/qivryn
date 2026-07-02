import path from "path";
import { describe, expect, it } from "vitest";
import { resolveQivrynGlobalDir } from "./paths";

describe("resolveQivrynGlobalDir", () => {
  it("uses the Qivryn directory by default", () => {
    expect(resolveQivrynGlobalDir({}, "/home/qivryn", "/workspace")).toBe(
      path.join("/home/qivryn", ".qivryn"),
    );
  });

  it("prefers QIVRYN_GLOBAL_DIR and accepts the legacy variable", () => {
    expect(
      resolveQivrynGlobalDir(
        {
          QIVRYN_GLOBAL_DIR: "new-state",
          CONTINUE_GLOBAL_DIR: "legacy-state",
        },
        "/home/qivryn",
        "/workspace",
      ),
    ).toBe(path.join("/workspace", "new-state"));

    expect(
      resolveQivrynGlobalDir(
        { CONTINUE_GLOBAL_DIR: "/tmp/legacy-qivryn-state" },
        "/home/qivryn",
        "/workspace",
      ),
    ).toBe("/tmp/legacy-qivryn-state");
  });
});
