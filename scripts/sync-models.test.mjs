import assert from "node:assert/strict";
import test from "node:test";

import { removeLegacyDefaultRules } from "./sync-models.mjs";

const legacyRules = [
  "You are a precise software engineering assistant. Think carefully before making changes.",
  "Prefer minimal, targeted edits. Always explain your reasoning concisely.",
  "When using tools, be explicit about which file and line you are editing.",
];

test("removes all legacy default rules", () => {
  const config = { rules: [...legacyRules] };

  assert.deepEqual(removeLegacyDefaultRules(config), {});
});

test("preserves custom string and structured rules", () => {
  const customRule = { name: "TypeScript", rule: "Use strict typing" };
  const config = {
    rules: [legacyRules[0], "Keep this custom rule", customRule],
  };

  assert.deepEqual(removeLegacyDefaultRules(config), {
    rules: ["Keep this custom rule", customRule],
  });
});

test("leaves configurations without a rules array unchanged", () => {
  const config = { name: "Example" };

  assert.strictEqual(removeLegacyDefaultRules(config), config);
  assert.deepEqual(config, { name: "Example" });
});
