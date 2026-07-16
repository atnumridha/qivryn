import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyProductOverlay } from "./product.mjs";
import { applyCodeOssPatches } from "./patches.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ideDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(ideDirectory, "..");
const buildDirectory = path.join(ideDirectory, ".build");
const vscodeDirectory = path.join(buildDirectory, "vscode");
const upstream = readJson(path.join(ideDirectory, "upstream.json"));
const productOverlay = readJson(
  path.join(ideDirectory, "product.overlay.json"),
);
const shouldReset = process.argv.includes("--reset");
const skipExtensionBuild = process.argv.includes("--skip-extension-build");
const vscodeTarget = process.env.QIVRYN_VSCODE_TARGET?.trim();
const minimumCheckoutBytes = 2 * 1024 * 1024 * 1024;

function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const detail = `\n${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`${command} ${args.join(" ")} failed${detail}`);
  }

  return options.capture ? result.stdout.trim() : undefined;
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

function assertCheckoutCapacity() {
  const stats = fs.statfsSync(ideDirectory);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);

  if (availableBytes < minimumCheckoutBytes) {
    const availableMiB = Math.floor(availableBytes / 1024 / 1024);
    throw new Error(
      `Code - OSS checkout requires at least 2 GiB free; ${availableMiB} MiB is available. Free disk space, then rerun npm run ide:prepare.`,
    );
  }
}

function ensureUpstreamCheckout() {
  if (shouldReset) {
    fs.rmSync(vscodeDirectory, { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(vscodeDirectory, ".git"))) {
    assertCheckoutCapacity();
    fs.mkdirSync(buildDirectory, { recursive: true });
    run("git", [
      "clone",
      "--filter=blob:none",
      "--depth=1",
      `--branch=${upstream.ref}`,
      upstream.repository,
      vscodeDirectory,
    ]);
  }

  const origin = run(
    "git",
    ["-C", vscodeDirectory, "config", "--get", "remote.origin.url"],
    { capture: true },
  );
  const commit = run("git", ["-C", vscodeDirectory, "rev-parse", "HEAD"], {
    capture: true,
  });

  if (origin !== upstream.repository) {
    throw new Error(
      `Unexpected Code - OSS origin ${origin}. Run npm run ide:prepare:reset.`,
    );
  }
  if (commit !== upstream.commit) {
    throw new Error(
      `Expected Code - OSS ${upstream.commit}, found ${commit}. Run npm run ide:prepare:reset.`,
    );
  }
}

function applyProductConfiguration() {
  const productPath = path.join(vscodeDirectory, "product.json");
  const product = applyProductOverlay(readJson(productPath), productOverlay);

  fs.writeFileSync(productPath, `${JSON.stringify(product, null, "\t")}\n`);
}

function removeUpstreamDefaultChatExtension() {
  fs.rmSync(path.join(vscodeDirectory, "extensions", "copilot"), {
    recursive: true,
    force: true,
  });

  const npmDirsPath = path.join(vscodeDirectory, "build", "npm", "dirs.ts");
  if (fs.existsSync(npmDirsPath)) {
    const current = fs.readFileSync(npmDirsPath, "utf8");
    const patched = current.replace(/^\s*'extensions\/copilot',\n/m, "");
    if (patched !== current) {
      fs.writeFileSync(npmDirsPath, patched);
    }
  }
}

function stageFoundationExtension() {
  copyDirectory(
    path.join(ideDirectory, "builtin", "qivryn-foundation"),
    path.join(vscodeDirectory, "extensions", "qivryn-foundation"),
  );
}

function stageQivrynExtension() {
  const extensionDirectory = path.join(repositoryRoot, "extensions", "vscode");
  const extensionPackage = readJson(
    path.join(extensionDirectory, "package.json"),
  );
  const vsixPath = path.join(
    extensionDirectory,
    "build",
    `qivryn-${extensionPackage.version}.vsix`,
  );

  if (!skipExtensionBuild) {
    run("npm", ["run", "prepackage"], {
      cwd: extensionDirectory,
      env: {
        ...process.env,
        // Windows packages a target-specific sqlite binary. Refresh it here
        // instead of relying on a host-built dependency from `npm ci`.
        SKIP_INSTALLS: process.platform === "win32" ? "false" : "true",
        ...(vscodeTarget ? { QIVRYN_VSCODE_TARGET: vscodeTarget } : {}),
      },
    });

    const packageArgs = ["run", "package"];
    if (vscodeTarget) {
      packageArgs.push("--", "--target", vscodeTarget);
    }

    run("npm", packageArgs, {
      cwd: extensionDirectory,
      env: { ...process.env, SKIP_INSTALLS: "true" },
    });
  }

  if (!fs.existsSync(vsixPath)) {
    throw new Error(
      `Missing ${vsixPath}. Build the extension or omit --skip-extension-build.`,
    );
  }

  const extractionDirectory = path.join(buildDirectory, "qivryn-vsix");
  fs.rmSync(extractionDirectory, { recursive: true, force: true });
  fs.mkdirSync(extractionDirectory, { recursive: true });
  run("unzip", ["-q", "-o", vsixPath, "-d", extractionDirectory]);

  const extractedExtension = path.join(extractionDirectory, "extension");
  const destination = path.join(vscodeDirectory, "extensions", "qivryn");
  copyDirectory(extractedExtension, destination);
  const builtInPackagePath = path.join(destination, "package.json");
  const builtInPackage = readJson(builtInPackagePath);
  delete builtInPackage.dependencies;
  delete builtInPackage.devDependencies;
  delete builtInPackage.optionalDependencies;
  delete builtInPackage.peerDependencies;
  fs.writeFileSync(
    builtInPackagePath,
    `${JSON.stringify(builtInPackage, null, 2)}\n`,
  );
  fs.rmSync(extractionDirectory, { recursive: true, force: true });
}

function stageBranding() {
  const mark = path.join(repositoryRoot, "media", "brand", "qivryn-mark.png");
  const trackedBranding = path.join(ideDirectory, "branding");
  const targets = [
    ["qivryn.png", ["resources", "linux", "code.png"]],
    ["qivryn.icns", ["resources", "darwin", "code.icns"]],
    ["qivryn.ico", ["resources", "win32", "code.ico"]],
  ];

  if (!fs.existsSync(mark)) {
    throw new Error(`Missing Qivryn brand mark at ${mark}`);
  }

  for (const [sourceName, destinationSegments] of targets) {
    const source = path.join(trackedBranding, sourceName);
    const destination = path.join(vscodeDirectory, ...destinationSegments);
    if (fs.existsSync(source) && fs.existsSync(path.dirname(destination))) {
      fs.copyFileSync(source, destination);
    }
  }
}

function writeProvenance() {
  const qivrynCommit = run("git", ["rev-parse", "HEAD"], { capture: true });
  fs.writeFileSync(
    path.join(buildDirectory, "provenance.json"),
    `${JSON.stringify(
      {
        qivrynCommit,
        upstream,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

ensureUpstreamCheckout();
applyProductConfiguration();
removeUpstreamDefaultChatExtension();
applyCodeOssPatches(vscodeDirectory);
stageFoundationExtension();
stageQivrynExtension();
stageBranding();
writeProvenance();

console.log(`Prepared Qivryn IDE at ${vscodeDirectory}`);
console.log("Next: npm run ide:install && npm run ide:watch");
