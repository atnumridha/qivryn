import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vscodeDirectory = path.resolve(scriptDirectory, "..", ".build", "vscode");
const [command, ...args] = process.argv.slice(2);

if (!command) {
  throw new Error("Provide a command to run in the prepared Code - OSS tree.");
}
if (!fs.existsSync(path.join(vscodeDirectory, "package.json"))) {
  throw new Error("Run npm run ide:prepare before running upstream commands.");
}

const result = spawnSync(command, args, {
  cwd: vscodeDirectory,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
