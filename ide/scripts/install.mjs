import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vscodeDirectory = path.resolve(scriptDirectory, "..", ".build", "vscode");
const copilotDirectory = path.join(vscodeDirectory, "extensions", "copilot");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: vscodeDirectory,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

if (!fs.existsSync(path.join(vscodeDirectory, ".git"))) {
  throw new Error("Prepare the pinned Code OSS checkout before installing it.");
}

// Code OSS 1.127 enumerates extensions/copilot during postinstall even when a
// downstream product does not ship it. Restore it only for dependency setup,
// then remove it so Qivryn never loads or packages the stock Chat extension.
run("git", ["restore", "--source=HEAD", "--worktree", "extensions/copilot"]);
try {
  run("npm", ["install"]);
} finally {
  fs.rmSync(copilotDirectory, { recursive: true, force: true });
}

console.log(
  "Installed Code OSS dependencies and removed the stock Chat extension.",
);
