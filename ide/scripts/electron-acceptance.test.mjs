import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const manifest = readJson("ide", "acceptance", "electron-agent-scenarios.json");
const extension = readJson("extensions", "vscode", "package.json");

test("tracks packaged acceptance for every in-progress native Agent area", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.package.sourceExtensionVersion, extension.version);
  assert.deepEqual(
    new Set(manifest.scenarios.map((scenario) => scenario.area)),
    new Set([
      "agent-first-workbench-layout",
      "native-agent-sessions",
      "native-agent-session-state",
      "qivryn-agent-window-handoff",
    ]),
  );
  assert.equal(
    new Set(manifest.scenarios.map((scenario) => scenario.id)).size,
    manifest.scenarios.length,
  );
  for (const scenario of manifest.scenarios) {
    assert.ok(scenario.acceptance.length > 0);
    assert.ok(scenario.steps.length > 0);
    assert.match(scenario.status, /^(not-run|passed|failed|blocked)$/);
  }
});

function readJson(...segments) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8"),
  );
}
