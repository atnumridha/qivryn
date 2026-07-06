import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const options = parseArgs(process.argv.slice(2));
const platform = required("platform");
const arch = required("arch");
const bundle = path.join(
  repositoryRoot,
  "ide",
  ".build",
  `VSCode-${platform}-${arch}`,
);
const appRoot =
  platform === "darwin" ? path.join(bundle, "Qivryn Agent IDE.app") : bundle;
const resources =
  platform === "darwin"
    ? path.join(appRoot, "Contents", "Resources", "app")
    : path.join(appRoot, "resources", "app");
const extension = path.join(resources, "extensions", "qivryn");
const manifestPath = path.join(extension, "package.json");
const extensionEntry = path.join(extension, "out", "extension.js");
const errors = [];

if (!fs.existsSync(appRoot)) errors.push(`Missing packaged app: ${appRoot}`);
if (!fs.existsSync(manifestPath))
  errors.push("Missing packaged Qivryn manifest");
if (!fs.existsSync(extensionEntry))
  errors.push("Missing packaged Qivryn entrypoint");

let manifest;
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const updateCommand = manifest.contributes?.commands?.find(
    (command) => command.command === "qivryn.checkForUpdates",
  );
  if (!updateCommand) errors.push("Missing packaged update command");
}

if (fs.existsSync(extensionEntry)) {
  const source = fs.readFileSync(extensionEntry, "utf8");
  for (const marker of [
    "api.github.com/repos/atnumridha/qivryn/releases/latest",
    "Qivryn could not check for updates",
    "Reload Window",
    "Open Logs",
  ]) {
    if (!source.includes(marker))
      errors.push(`Missing recovery marker: ${marker}`);
  }
}

const result = {
  schemaVersion: 1,
  platform,
  arch,
  extensionVersion: manifest?.version,
  updateSource: "github-releases",
  boundedRetries: [1_000, 3_000, 7_000],
  actions: ["Retry", "Reload Window", "Open Logs"],
  passed: errors.length === 0,
  errors,
};
const output = options.output
  ? path.resolve(options.output)
  : path.join(
      repositoryRoot,
      "ide",
      ".build",
      "acceptance",
      `recovery-${platform}-${arch}.json`,
    );
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, ...result }, null, 2));
if (errors.length > 0) process.exitCode = 1;

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--")) continue;
    parsed[key.slice(2)] = args[++index];
  }
  return parsed;
}

function required(name) {
  const value = options[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}
