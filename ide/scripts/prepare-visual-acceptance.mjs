import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "ide", "visual-reference", "manifest.json"),
    "utf8",
  ),
);
const referenceApp = resolveReferenceApp();
const qivrynApp = path.join(
  repositoryRoot,
  "ide",
  ".build",
  "VSCode-darwin-arm64",
  "Qivryn Agent IDE.app",
);
const errors = [];

validateApp(referenceApp, "reference");
validateApp(qivrynApp, "Qivryn");
if (isInside(referenceApp, repositoryRoot)) {
  errors.push(
    "The proprietary reference app must remain outside the repository",
  );
}
if (/cursor/i.test(path.basename(qivrynApp))) {
  errors.push("Qivryn application path contains forbidden Cursor branding");
}

const cases = manifest.themes.flatMap((theme) =>
  manifest.states.flatMap((state) =>
    manifest.viewports.map(({ width, height }) => ({
      id: `${theme}/${state}-${width}x${height}`,
      theme,
      state,
      viewport: { width, height },
      referenceOutput: path.join(
        manifest.goldenDirectory,
        theme,
        `${state}-${width}x${height}.png`,
      ),
      qivrynOutput: path.join(
        manifest.actualDirectory,
        theme,
        `${state}-${width}x${height}.png`,
      ),
    })),
  ),
);
const plan = {
  schemaVersion: 1,
  referenceApp,
  qivrynApp,
  cases,
  productAssetPolicy:
    "Reference screenshots remain test evidence only and are never packaged as Qivryn icons, logos, or product assets.",
  ready: errors.length === 0,
  errors,
};
const output = path.join(
  repositoryRoot,
  "ide",
  "visual-reference",
  "capture-plan.json",
);
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(
  JSON.stringify(
    { output, referenceApp, qivrynApp, cases: cases.length, errors },
    null,
    2,
  ),
);
if (errors.length > 0) process.exitCode = 1;

function resolveReferenceApp() {
  const candidates = [
    process.env.QIVRYN_VISUAL_REFERENCE_APP,
    "/Users/atanumridha/Downloads/VSCode-darwin-arm64/Codie.app",
    "/Users/atanumridha/Downloads/Codie-ResilienceFix-20260617.app",
  ].filter(Boolean);
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

function validateApp(app, label) {
  if (!app || !fs.existsSync(app)) {
    errors.push(`Missing ${label} application: ${app ?? "not configured"}`);
    return;
  }
  const executableDirectory = path.join(app, "Contents", "MacOS");
  if (
    !fs.existsSync(executableDirectory) ||
    fs.readdirSync(executableDirectory).length === 0
  ) {
    errors.push(`${label} application has no macOS executable: ${app}`);
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
