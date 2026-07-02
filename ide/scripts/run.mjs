import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vscodeDirectory = path.resolve(scriptDirectory, "..", ".build", "vscode");
const launcher =
  process.platform === "win32"
    ? path.join(vscodeDirectory, "scripts", "code.bat")
    : path.join(vscodeDirectory, "scripts", "code.sh");

if (!fs.existsSync(launcher)) {
  throw new Error("Run npm run ide:prepare before launching Qivryn IDE.");
}

const result = spawnSync(launcher, process.argv.slice(2), {
  cwd: vscodeDirectory,
  env: { ...process.env, QIVRYN_IDE: "1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
