#!/usr/bin/env node
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const packageRoot = path.resolve(new URL("..", import.meta.url).pathname);
const defaultQivrynGuiRoot = "/Users/amridha/Documents/qivryn/gui";
const qivrynGuiRoot =
  process.env.QIVRYN_GUI_ROOT || defaultQivrynGuiRoot;
const extensionRoot = path.join(packageRoot, "extension", "chrome");
const extensionQivrynRoot = path.join(extensionRoot, "qivryn");
const chromeOwnedDist = path.join(packageRoot, "vendor", "qivryn-gui-dist");
const skipBuild =
  args.includes("--skip-build") || process.env.QIVRYN_SKIP_BUILD === "1";
const refreshFromQivryn =
  args.includes("--refresh-from-qivryn") ||
  process.env.QIVRYN_REFRESH_FROM_QIVRYN === "1" ||
  process.env.QIVRYN_REFRESH_GUI === "1";

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

const sourceDistArg = optionValue("--source-dist");
const explicitSourceDist = sourceDistArg || process.env.QIVRYN_GUI_DIST;
const qivrynDist = explicitSourceDist
  ? path.resolve(explicitSourceDist)
  : path.join(qivrynGuiRoot, "dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function pathExists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertBuiltDist(distRoot, label) {
  const indexHtml = path.join(distRoot, "index.html");
  if (await pathExists(indexHtml)) {
    return;
  }

  if (distRoot === chromeOwnedDist) {
    throw new Error(
      [
        `${label} is missing: ${indexHtml}`,
        "Chrome and VS Code are intentionally maintained separately.",
        "Seed or refresh the Chrome-owned UI snapshot with:",
        "  npm run build:chrome-extension -- --refresh-from-qivryn",
      ].join("\n"),
    );
  }

  throw new Error(`${label} is missing: ${indexHtml}`);
}

async function refreshChromeOwnedDist(sourceDist, label) {
  await assertBuiltDist(sourceDist, label);
  await rm(chromeOwnedDist, { recursive: true, force: true });
  await mkdir(path.dirname(chromeOwnedDist), { recursive: true });
  await cp(sourceDist, chromeOwnedDist, { recursive: true });
  console.log(`Refreshed Chrome-owned Qivryn GUI snapshot from ${sourceDist}`);
}

async function patchHtml(file) {
  let html = await readFile(file, "utf8");
  html = html.replace(/\b(src|href)="\/([^"]+)"/g, '$1="./$2"');
  html = html
    .replace(/\s*<link rel="stylesheet" href="\.\.\/qivryn-host\.css" \/>\n?/g, "")
    .replace(/\s*<script src="\.\.\/qivryn-host\.js"><\/script>\n?/g, "");
  html = html.replace(
    /(<script type="module" crossorigin src="\.\/assets\/index(?:Console)?\.js"><\/script>)/,
    '    <link rel="stylesheet" href="../qivryn-host.css" />\n    <script src="../qivryn-host.js"></script>\n    $1',
  );
  await writeFile(file, html, "utf8");
}

if (refreshFromQivryn && !explicitSourceDist && !skipBuild) {
  run("npm", ["run", "build"], { cwd: qivrynGuiRoot });
}

if (refreshFromQivryn || explicitSourceDist) {
  await refreshChromeOwnedDist(
    qivrynDist,
    explicitSourceDist ? "Explicit Qivryn GUI dist" : "Qivryn GUI dist",
  );
} else {
  await assertBuiltDist(chromeOwnedDist, "Chrome-owned Qivryn GUI snapshot");
}

await rm(extensionQivrynRoot, { recursive: true, force: true });
await mkdir(extensionQivrynRoot, { recursive: true });
await cp(chromeOwnedDist, extensionQivrynRoot, { recursive: true });
await patchHtml(path.join(extensionQivrynRoot, "index.html"));
await patchHtml(path.join(extensionQivrynRoot, "indexConsole.html")).catch(() => undefined);

console.log(`Copied Chrome-owned Qivryn GUI build into ${extensionQivrynRoot}`);
