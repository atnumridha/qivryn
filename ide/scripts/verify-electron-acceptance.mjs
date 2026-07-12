import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const manifestPath = path.join(
  repositoryRoot,
  "ide",
  "acceptance",
  "electron-agent-scenarios.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];
const allowed = new Set(["not-run", "passed", "failed", "blocked"]);
const packageConfiguration = manifest.package ?? {};
if (manifest.schemaVersion !== 1) {
  errors.push(`Unsupported acceptance schema: ${manifest.schemaVersion}`);
}
if (
  typeof packageConfiguration.path !== "string" ||
  typeof packageConfiguration.sourceExtensionVersion !== "string"
) {
  errors.push("Acceptance package requires path and sourceExtensionVersion");
}
const packageRoot = path.join(
  repositoryRoot,
  typeof packageConfiguration.path === "string"
    ? packageConfiguration.path
    : "ide/.build/missing-package",
);
const appRoot = path.join(packageRoot, "Qivryn Agent IDE.app");
const packagedManifestPath = path.join(
  appRoot,
  "Contents",
  "Resources",
  "app",
  "extensions",
  "qivryn",
  "package.json",
);
const packagedExtensionVersion = fs.existsSync(packagedManifestPath)
  ? JSON.parse(fs.readFileSync(packagedManifestPath, "utf8")).version
  : undefined;
const packageStatus = !fs.existsSync(appRoot)
  ? {
      status: "blocked",
      blocker:
        "The packaged Qivryn app is missing. Build it with npm run ide:package:mac.",
    }
  : packagedExtensionVersion !== packageConfiguration.sourceExtensionVersion
    ? {
        status: "blocked",
        blocker: `The packaged extension is ${packagedExtensionVersion ?? "missing"}; expected ${packageConfiguration.sourceExtensionVersion}.`,
      }
    : { status: "ready", blocker: undefined };

const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
const scenarioIds = new Set();
for (const scenario of scenarios) {
  if (!scenario.id || !scenario.acceptance) {
    errors.push("Every Electron scenario requires id and acceptance");
  }
  if (scenarioIds.has(scenario.id)) {
    errors.push(`Duplicate Electron scenario id: ${scenario.id}`);
  }
  scenarioIds.add(scenario.id);
  if (!allowed.has(scenario.status)) {
    errors.push(`${scenario.id}: invalid status ${scenario.status}`);
  }
  if (scenario.status === "passed") {
    if (!scenario.evidence) {
      errors.push(`${scenario.id}: passed scenarios require evidence`);
    } else if (!fs.existsSync(path.join(repositoryRoot, scenario.evidence))) {
      errors.push(
        `${scenario.id}: evidence does not exist: ${scenario.evidence}`,
      );
    }
  }
  if (scenario.status === "blocked" && !scenario.blocker) {
    errors.push(`${scenario.id}: blocked scenarios require blocker`);
  }
}

if (scenarios.length === 0) {
  errors.push("At least one Electron acceptance scenario is required");
}

const summary = Object.fromEntries(
  [...allowed].map((status) => [
    status,
    scenarios.filter((scenario) => scenario.status === status).length,
  ]),
);
console.log(
  JSON.stringify(
    {
      package: {
        ...packageConfiguration,
        packagedExtensionVersion,
        ...packageStatus,
      },
      summary,
    },
    null,
    2,
  ),
);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (packageStatus.status === "blocked") {
  console.error(packageStatus.blocker);
  process.exitCode = 1;
} else if (scenarios.some((scenario) => scenario.status !== "passed")) {
  console.error("Electron acceptance is incomplete; every scenario must pass.");
  process.exitCode = 1;
}
