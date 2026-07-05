import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ideDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(ideDirectory, "..");
const buildDirectory = path.join(ideDirectory, ".build");
const vscodeDirectory = path.join(buildDirectory, "vscode");

const options = parseOptions(process.argv.slice(2));
const platform = requiredOption("platform");
const arch = requiredOption("arch");
const outputDirectory = path.resolve(
  options["out-dir"] ?? path.join(buildDirectory, "installers"),
);
const version = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "extensions", "vscode", "package.json"),
    "utf8",
  ),
).version;

fs.mkdirSync(outputDirectory, { recursive: true });

const artifacts = [];
const bundleName = `VSCode-${platform}-${arch}`;
const bundleDirectory = path.join(buildDirectory, bundleName);

if (!fs.existsSync(bundleDirectory)) {
  throw new Error(`Missing packaged IDE directory: ${bundleDirectory}`);
}

if (platform === "darwin") {
  const appPath = path.join(bundleDirectory, "Qivryn Agent IDE.app");
  if (!fs.existsSync(appPath)) {
    throw new Error(`Missing macOS app bundle: ${appPath}`);
  }

  const artifact = path.join(
    outputDirectory,
    `qivryn-${version}-darwin-${arch}.zip`,
  );
  run("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    appPath,
    artifact,
  ]);
  artifacts.push(artifact);
} else if (platform === "linux") {
  const artifact = path.join(
    outputDirectory,
    `qivryn-${version}-linux-${arch}.tar.gz`,
  );
  run("tar", ["-czf", artifact, "-C", buildDirectory, bundleName]);
  artifacts.push(artifact);

  copyMatchingArtifacts(path.join(vscodeDirectory, ".build", "linux"), [
    ".deb",
    ".rpm",
    ".snap",
  ]);
} else if (platform === "win32") {
  const artifact = path.join(
    outputDirectory,
    `qivryn-${version}-win32-${arch}.zip`,
  );

  if (process.platform === "win32") {
    run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        `Compress-Archive -Path ${quotePowerShellPath(path.join(bundleDirectory, "*"))} -DestinationPath ${quotePowerShellPath(artifact)} -Force`,
      ].join("; "),
    ]);
  } else {
    run("zip", ["-qry", artifact, bundleName], { cwd: buildDirectory });
  }
  artifacts.push(artifact);

  copyMatchingArtifacts(path.join(vscodeDirectory, ".build", `win32-${arch}`), [
    ".exe",
  ]);
} else {
  throw new Error(`Unsupported platform: ${platform}`);
}

const manifestPath = path.join(
  outputDirectory,
  `qivryn-${version}-${platform}-${arch}.json`,
);
const manifest = {
  version,
  platform,
  arch,
  generatedAt: new Date().toISOString(),
  artifacts: artifacts.map((artifact) => ({
    name: path.basename(artifact),
    bytes: fs.statSync(artifact).size,
    sha256: sha256(artifact),
  })),
};

for (const artifact of artifacts) {
  fs.writeFileSync(
    `${artifact}.sha256`,
    `${sha256(artifact)}  ${path.basename(artifact)}\n`,
  );
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packaged ${artifacts.length} artifact(s):`);
for (const artifact of artifacts) {
  console.log(`- ${artifact}`);
}

function parseOptions(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = value;
      i += 1;
    }
  }
  return parsed;
}

function requiredOption(name) {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function copyMatchingArtifacts(root, extensions) {
  if (!fs.existsSync(root)) {
    return;
  }

  for (const filePath of walk(root)) {
    if (!extensions.some((extension) => filePath.endsWith(extension))) {
      continue;
    }

    const destination = uniqueDestination(
      path.join(outputDirectory, path.basename(filePath)),
    );
    fs.copyFileSync(filePath, destination);
    artifacts.push(destination);
  }
}

function* walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function uniqueDestination(filepath) {
  if (!fs.existsSync(filepath)) {
    return filepath;
  }

  const parsed = path.parse(filepath);
  let index = 2;
  while (true) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}-${index}${parsed.ext}`,
    );
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function sha256(filepath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filepath));
  return hash.digest("hex");
}

function quotePowerShellPath(filepath) {
  return `'${filepath.replace(/'/g, "''")}'`;
}
