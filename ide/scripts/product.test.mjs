import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyProductOverlay, assertProductOverlay } from "./product.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ideDirectory = path.resolve(scriptDirectory, "..");
const overlay = JSON.parse(
  fs.readFileSync(path.join(ideDirectory, "product.overlay.json"), "utf8"),
);

test("applies Qivryn identity without dropping upstream extensions", () => {
  const upstream = {
    nameShort: "Code - OSS",
    applicationName: "code-oss",
    defaultChatAgent: { extensionId: "upstream.chat" },
    builtInExtensionsEnabledWithAutoUpdates: ["upstream.chat"],
    trustedExtensionAuthAccess: { github: ["upstream.chat"] },
    voiceWsUrl: "wss://upstream.invalid",
    builtInExtensions: [{ name: "upstream.extension" }],
  };

  const product = applyProductOverlay(upstream, overlay);

  assert.equal(product.nameShort, "Qivryn");
  assert.equal(product.applicationName, "qivryn");
  assert.equal(product.defaultChatAgent, undefined);
  assert.deepEqual(product.builtInExtensionsEnabledWithAutoUpdates, []);
  assert.deepEqual(product.trustedExtensionAuthAccess, {});
  assert.deepEqual(product.extensionEnabledApiProposals, {
    "Qivryn.qivryn": [
      "agentSessionsWorkspace",
      "agentsWindowConfiguration",
      "chatParticipantAdditions",
      "chatParticipantPrivate",
      "chatSessionsProvider",
    ],
  });
  assert.equal(product.voiceWsUrl, undefined);
  assert.deepEqual(product.builtInExtensions, upstream.builtInExtensions);
  assert.deepEqual(upstream.defaultChatAgent, {
    extensionId: "upstream.chat",
  });
  assert.doesNotThrow(() => assertProductOverlay(product, overlay));
});

test("rejects an incompletely branded product", () => {
  assert.throws(
    () => assertProductOverlay({ nameShort: "Code - OSS" }, overlay),
    /nameShort/,
  );
});
