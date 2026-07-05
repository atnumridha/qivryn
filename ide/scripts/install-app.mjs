import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const source = path.join(
  repositoryRoot,
  "ide",
  ".build",
  "VSCode-darwin-arm64",
  "Qivryn Agent IDE.app",
);
const target =
  process.env.QIVRYN_INSTALL_PATH ?? "/Applications/Qivryn Agent IDE.app";
const staging = `${target}.staging-${process.pid}`;
const backup = `${target}.previous-${process.pid}`;

if (process.platform !== "darwin") {
  throw new Error("ide:install:mac can only install the macOS application.");
}
if (!fs.existsSync(source)) {
  throw new Error("Run npm run ide:package:mac before installing Qivryn.");
}

try {
  fs.rmSync(staging, { recursive: true, force: true });
  const copy = spawnSync("/usr/bin/ditto", [source, staging], {
    encoding: "utf8",
  });
  if (copy.status !== 0) {
    throw new Error(
      copy.stderr || copy.stdout || "ditto failed to copy Qivryn",
    );
  }
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  fs.renameSync(staging, target);
  fs.rmSync(backup, { recursive: true, force: true });
  console.log(`Installed Qivryn Agent IDE at ${target}`);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  if (!fs.existsSync(target) && fs.existsSync(backup)) {
    fs.renameSync(backup, target);
  }
  throw error;
}
