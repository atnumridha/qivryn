import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "ide", "visual-reference", "manifest.json"),
    "utf8",
  ),
);

const missing = [];
for (const theme of manifest.themes) {
  for (const state of manifest.states) {
    for (const viewport of manifest.viewports) {
      const name = `${state}-${viewport.width}x${viewport.height}.png`;
      for (const directory of [
        manifest.goldenDirectory,
        manifest.actualDirectory,
      ]) {
        const candidate = path.join(repositoryRoot, directory, theme, name);
        if (!fs.existsSync(candidate)) missing.push(candidate);
      }
    }
  }
}

const expectedPairs =
  manifest.themes.length * manifest.states.length * manifest.viewports.length;
console.log(
  JSON.stringify(
    {
      reference: `${manifest.reference.product} ${manifest.reference.version}`,
      expectedPairs,
      structuralDeltaPixels:
        manifest.thresholds.maximumStructuralRegionDeltaPixels,
      pixelDifferenceRatio:
        manifest.thresholds.maximumOverallPixelDifferenceRatio,
      missing: missing.length,
    },
    null,
    2,
  ),
);

if (missing.length > 0) {
  console.error(
    `Visual acceptance is incomplete; first missing file: ${missing[0]}`,
  );
  process.exitCode = 1;
} else {
  for (const theme of manifest.themes) {
    for (const state of manifest.states) {
      for (const viewport of manifest.viewports) {
        const name = `${state}-${viewport.width}x${viewport.height}.png`;
        const golden = path.join(
          repositoryRoot,
          manifest.goldenDirectory,
          theme,
          name,
        );
        const actual = path.join(
          repositoryRoot,
          manifest.actualDirectory,
          theme,
          name,
        );
        const mask = golden.replace(/\.png$/, ".mask.png");
        const result = spawnSync(
          process.env.QIVRYN_PYTHON ?? "python3",
          [
            path.join(scriptDirectory, "compare-visuals.py"),
            golden,
            actual,
            String(manifest.thresholds.maximumStructuralRegionDeltaPixels),
            String(manifest.thresholds.maximumOverallPixelDifferenceRatio),
            mask,
          ],
          { encoding: "utf8" },
        );
        if (result.status !== 0) {
          console.error(
            `Visual parity failed for ${theme}/${name}: ${result.stdout || result.stderr}`,
          );
          process.exitCode = 1;
          process.exit();
        }
      }
    }
  }
  console.log(`Visual parity passed for ${expectedPairs} golden/actual pairs.`);
}
