import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");

function readJson(...segments) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, ...segments), "utf8"),
  );
}

const themeVariants = [
  {
    name: "Qivryn Dark",
    referenceHash:
      "ca42bceb1a6febcd1127f41254d5d9708a31e876c5fe156df286981e03d3ff02",
    extension: "qivryn-dark.json",
    foundation: "qivryn-dark-color-theme.json",
  },
  {
    name: "Qivryn Midnight",
    referenceHash:
      "b1ce5a88677697d9b82593d0ce9376d211d53060c1b251da4997da483bcb6dae",
    extension: "qivryn-midnight.json",
    foundation: "qivryn-midnight-color-theme.json",
  },
  {
    name: "Qivryn Light",
    referenceHash:
      "8b462fa5a8f6ccdae371fe65cc15f4637ad4b79143c38e183b3a53044448be07",
    extension: "qivryn-light.json",
    foundation: "qivryn-light-color-theme.json",
  },
  {
    name: "Qivryn High Contrast",
    referenceHash:
      "d7287ea5798cdb5c239131b284f05ff6f7318bfcb5efbe410eeab6e52b80e133",
    extension: "qivryn-high-contrast.json",
    foundation: "qivryn-high-contrast-color-theme.json",
  },
];

test("IDE and extension themes preserve the complete CodieApp visual token sets", () => {
  for (const variant of themeVariants) {
    const extensionTheme = readJson(
      "extensions",
      "vscode",
      "themes",
      variant.extension,
    );
    const foundationTheme = readJson(
      "ide",
      "builtin",
      "qivryn-foundation",
      "themes",
      variant.foundation,
    );

    for (const theme of [extensionTheme, foundationTheme]) {
      assert.equal(theme.name, variant.name);
      const comparableTheme = { ...theme };
      delete comparableTheme.name;
      assert.equal(
        crypto
          .createHash("sha256")
          .update(JSON.stringify(comparableTheme))
          .digest("hex"),
        variant.referenceHash,
      );
    }
  }
});

test("the built-in distribution starts cleanly in an agent-first workbench", () => {
  const extension = readJson(
    "ide",
    "builtin",
    "qivryn-foundation",
    "package.json",
  );
  const defaults = extension.contributes.configurationDefaults;

  assert.equal(defaults["workbench.startupEditor"], "none");
  assert.equal(defaults["window.commandCenter"], true);
  assert.equal(defaults["window.titleBarStyle"], undefined);
  assert.equal(defaults["workbench.layoutControl.enabled"], true);
  assert.equal(defaults["workbench.editor.enablePreview"], false);
  assert.equal(
    defaults["workbench.secondarySideBar.defaultVisibility"],
    "hidden",
  );
  assert.equal(defaults["terminal.integrated.defaultLocation"], "view");
  assert.equal(defaults["chat.viewSessions.enabled"], false);
  assert.equal(defaults["chat.viewSessions.orientation"], "stacked");
  assert.equal(defaults["chat.agentsControl.enabled"], "hidden");
  assert.equal(defaults["chat.agentsHandoffTip.mode"], "hidden");
});

test("the CodieApp visual gate covers every required state and theme", () => {
  const manifest = readJson("ide", "visual-reference", "manifest.json");
  assert.deepEqual(manifest.themes, [
    "dark",
    "midnight",
    "light",
    "high-contrast",
  ]);
  assert.equal(manifest.states.length, 12);
  assert.equal(manifest.viewports.length, 3);
  assert.equal(manifest.thresholds.maximumStructuralRegionDeltaPixels, 2);
  assert.equal(manifest.thresholds.maximumOverallPixelDifferenceRatio, 0.015);
});
