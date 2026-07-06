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
const packageRoot = path.join(repositoryRoot, manifest.package.path);
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
  : packagedExtensionVersion !== manifest.package.sourceExtensionVersion
    ? {
        status: "blocked",
        blocker: `The packaged extension is ${packagedExtensionVersion ?? "missing"}; expected ${manifest.package.sourceExtensionVersion}.`,
      }
    : { status: "ready", blocker: undefined };

for (const scenario of manifest.scenarios ?? []) {
  if (!scenario.id || !scenario.acceptance) {
    errors.push("Every Electron scenario requires id and acceptance");
  }
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
}

const summary = Object.fromEntries(
  [...allowed].map((status) => [
    status,
    manifest.scenarios.filter((scenario) => scenario.status === status).length,
  ]),
);
console.log(
  JSON.stringify(
    {
      package: {
        ...manifest.package,
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
}
