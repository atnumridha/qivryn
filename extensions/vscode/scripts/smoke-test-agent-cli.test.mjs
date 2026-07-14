import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertDaemonHealth,
  parseRunListOutput,
  PROTOCOL_VERSION,
  selectVsix,
} from "./smoke-test-agent-cli.mjs";

test("parses structured output after dependency logs", () => {
  assert.deepEqual(
    parseRunListOutput('dependency notice\n{\n  "runs": []\n}\n'),
    { runs: [] },
  );
  assert.throws(() => parseRunListOutput("not json"), /JSON run list/);
});

test("validates the authenticated daemon health contract", () => {
  assert.doesNotThrow(() =>
    assertDaemonHealth({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { local: true, persistent: true },
    }),
  );
  assert.throws(
    () =>
      assertDaemonHealth({
        protocolVersion: PROTOCOL_VERSION - 1,
        capabilities: { local: true, persistent: true },
      }),
    new RegExp(`protocol ${PROTOCOL_VERSION}`),
  );
});

test("selects the newest VSIX deterministically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qivryn-vsix-list-"));
  try {
    const oldPath = path.join(directory, "old.vsix");
    const newPath = path.join(directory, "new.vsix");
    await writeFile(oldPath, "old");
    await writeFile(newPath, "new");
    const now = new Date();
    fs.utimesSync(
      oldPath,
      new Date(now.getTime() - 2_000),
      new Date(now.getTime() - 2_000),
    );
    fs.utimesSync(newPath, now, now);
    assert.equal(selectVsix(directory), newPath);
    assert.equal(selectVsix(directory, oldPath), path.resolve(oldPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
