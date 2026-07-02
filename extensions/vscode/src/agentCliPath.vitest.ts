import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentCliPath } from "./agentCliPath";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

describe("agent CLI path", () => {
  it("prefers the runtime bundled in the extension", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qivryn-cli-path-"));
    roots.push(root);
    const cli = path.join(root, "out", "cli", "qivryn.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "#!/usr/bin/env node\n");
    expect(resolveAgentCliPath(root)).toBe(cli);
  });

  it("returns undefined when neither packaged nor development CLI exists", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "qivryn-cli-path-"));
    roots.push(parent);
    const root = path.join(parent, "vscode");
    fs.mkdirSync(root);
    expect(resolveAgentCliPath(root)).toBeUndefined();
  });
});
