const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ncp = require("ncp").ncp;
const { rimrafSync } = require("rimraf");

const {
  validateFilesPresent,
  execCmdSync,
  autodetectPlatformAndArch,
} = require("../../../scripts/util/index");

const { copySqlite } = require("./download-copy-sqlite");
const { generateAndCopyConfigYamlSchema } = require("./generate-copy-config");
const { installAndCopyNodeModules } = require("./install-copy-nodemodule");
const { npmInstall } = require("./npm-install");
const {
  writeBuildTimestamp,
  qivrynDir,
  copyOnnxWasmFromNodeModules,
} = require("./utils");

function bundleAgentCli() {
  const cliRoot = path.join(qivrynDir, "extensions", "cli");
  const cliDist = path.join(cliRoot, "dist");
  const required = [
    "qivryn.js",
    "index.js",
    "package.json",
    "xhr-sync-worker.js",
  ];
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const hasBuiltCli = required.every((filename) =>
    fs.existsSync(path.join(cliDist, filename)),
  );
  if (!hasBuiltCli) {
    console.log("[info] Building self-contained agent CLI for the VSIX");
    execFileSync(npm, ["run", "build"], {
      cwd: cliRoot,
      env: process.env,
      stdio: "inherit",
    });
  } else {
    console.log("[info] Reusing existing CLI build from extensions/cli/dist");
  }
  const destination = path.join(
    qivrynDir,
    "extensions",
    "vscode",
    "out",
    "cli",
  );
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of required) {
    fs.copyFileSync(
      path.join(cliDist, filename),
      path.join(destination, filename),
    );
  }
  fs.chmodSync(path.join(destination, "qivryn.js"), 0o755);
  console.log("[info] Bundled the Qivryn agent CLI runtime");
}

function bundleDefaultConfig() {
  const source = path.join(qivrynDir, ".qivryn-config", "config.yaml");
  const destination = path.join(
    qivrynDir,
    "extensions",
    "vscode",
    "out",
    "default-config.yaml",
  );
  if (!fs.existsSync(source)) {
    throw new Error(`Missing canonical Qivryn config: ${source}`);
  }
  fs.copyFileSync(source, destination);
  console.log("[info] Bundled the default Qivryn provider configuration");
}

function copyDependencyTree(
  packageName,
  sourceNodeModules,
  destinationNodeModules,
  seen = new Set(),
  resolverRoot = sourceNodeModules,
) {
  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [resolverRoot, sourceNodeModules],
    });
  } catch {
    console.warn(
      `[warn] Optional packaged dependency is unavailable: ${packageName}`,
    );
    return;
  }

  const sourcePackage = path.dirname(packageJsonPath);
  const nestedRoot = path.join(resolverRoot, "node_modules");
  const isNested = sourcePackage.startsWith(`${nestedRoot}${path.sep}`);
  const destinationRoot = isNested
    ? path.join(
        destinationNodeModules,
        path.relative(sourceNodeModules, nestedRoot),
      )
    : destinationNodeModules;
  const destinationPackage = path.join(destinationRoot, packageName);
  const key = `${sourcePackage}:${destinationPackage}`;
  if (seen.has(key)) return;
  seen.add(key);

  fs.mkdirSync(path.dirname(destinationPackage), { recursive: true });
  fs.cpSync(sourcePackage, destinationPackage, {
    recursive: true,
    dereference: true,
  });

  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies)) {
    copyDependencyTree(
      dependency,
      sourceNodeModules,
      destinationNodeModules,
      seen,
      sourcePackage,
    );
  }
}

function bundleVoiceTranscriptionDependencies(target) {
  const sourceNodeModules = path.join(qivrynDir, "core", "node_modules");
  const destinationNodeModules = path.join(
    qivrynDir,
    "extensions",
    "vscode",
    "out",
    "node_modules",
  );
  copyDependencyTree("sharp", sourceNodeModules, destinationNodeModules);

  const sharpManifest = path.join(
    destinationNodeModules,
    "sharp",
    "package.json",
  );
  if (!fs.existsSync(sharpManifest)) {
    throw new Error("Failed to package sharp for local voice transcription");
  }
  const [hostOs, hostArch] = autodetectPlatformAndArch();
  if (`${hostOs}-${hostArch}` === target) {
    execFileSync(
      process.execPath,
      ["-e", "require('./out/node_modules/sharp')"],
      { cwd: path.join(qivrynDir, "extensions", "vscode"), stdio: "inherit" },
    );
  }
  console.log("[info] Bundled sharp for local voice transcription");
}

function resolveLanceDbPackageSpec(packageName) {
  let manifestPath;
  try {
    manifestPath = require.resolve("vectordb/package.json", {
      paths: [path.join(qivrynDir, "extensions", "vscode", "node_modules")],
    });
  } catch {
    return packageName;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version =
    manifest.optionalDependencies?.[packageName] ?? manifest.version;
  return version ? `${packageName}@${version}` : packageName;
}

// Clear folders that will be packaged to ensure clean slate
rimrafSync(path.join(__dirname, "..", "bin"));
rimrafSync(path.join(__dirname, "..", "out"));
fs.mkdirSync(path.join(__dirname, "..", "out", "node_modules"), {
  recursive: true,
});
const guiDist = path.join(__dirname, "..", "..", "..", "gui", "dist");
if (!fs.existsSync(guiDist)) {
  fs.mkdirSync(guiDist, { recursive: true });
}

const skipInstalls = process.env.SKIP_INSTALLS === "true";

// Get the target to package for
let target = undefined;
const args = process.argv;
if (args[2] === "--target") {
  target = args[3];
}
if (!target) {
  const envTarget =
    process.env.QIVRYN_VSCODE_TARGET ||
    process.env.QIVRYN_BUILD_TARGET ||
    process.env.VSCODE_TARGET;
  if (envTarget && typeof envTarget === "string") {
    target = envTarget.trim();
  }
}

let os;
let arch;
if (target) {
  [os, arch] = target.split("-");
} else {
  [os, arch] = autodetectPlatformAndArch();
}

if (os === "alpine") {
  os = "linux";
}
if (arch === "armhf") {
  arch = "arm64";
}
target = `${os}-${arch}`;
console.log("[info] Using target: ", target);

const exe = os === "win32" ? ".exe" : "";

const isWinTarget = target?.startsWith("win");
const isLinuxTarget = target?.startsWith("linux");
const isMacTarget = target?.startsWith("darwin");
function packagedSharpBinaryPath() {
  const releaseDirectory = "out/node_modules/sharp/build/Release";
  const candidates = [
    `${releaseDirectory}/sharp-${os}-${arch}v8.node`,
    `${releaseDirectory}/sharp-${os}-${arch}.node`,
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  );
}

void (async () => {
  const startTime = Date.now();
  console.log(
    `[info] Packaging extension for target ${target} - started at ${new Date().toISOString()}`,
  );

  // Make sure we have an initial timestamp file
  writeBuildTimestamp();
  bundleDefaultConfig();

  if (!skipInstalls) {
    const installStart = Date.now();
    console.log(`[timer] Starting npm installs at ${new Date().toISOString()}`);
    await Promise.all([generateAndCopyConfigYamlSchema(), npmInstall()]);
    console.log(
      `[timer] npm installs completed in ${Date.now() - installStart}ms`,
    );
  }

  process.chdir(path.join(qivrynDir, "gui"));

  // Copy over the dist folder to the JetBrains extension //
  const intellijExtensionWebviewPath = path.join(
    "..",
    "extensions",
    "intellij",
    "src",
    "main",
    "resources",
    "webview",
  );

  const indexHtmlPath = path.join(intellijExtensionWebviewPath, "index.html");
  fs.copyFileSync(indexHtmlPath, "tmp_index.html");
  rimrafSync(intellijExtensionWebviewPath);
  fs.mkdirSync(intellijExtensionWebviewPath, { recursive: true });

  const jetbrainsCopyStart = Date.now();
  console.log(`[timer] Starting JetBrains copy at ${new Date().toISOString()}`);
  await new Promise((resolve, reject) => {
    ncp("dist", intellijExtensionWebviewPath, (error) => {
      if (error) {
        console.warn(
          "[error] Error copying React app build to JetBrains extension: ",
          error,
        );
        reject(error);
      }
      resolve();
    });
  });
  console.log(
    `[timer] JetBrains copy completed in ${Date.now() - jetbrainsCopyStart}ms`,
  );

  // Put back index.html
  if (fs.existsSync(indexHtmlPath)) {
    rimrafSync(indexHtmlPath);
  }
  fs.copyFileSync("tmp_index.html", indexHtmlPath);
  fs.unlinkSync("tmp_index.html");

  console.log("[info] Copied gui build to JetBrains extension");

  // Then copy over the dist folder to the VSCode extension //
  const vscodeGuiPath = path.join("../extensions/vscode/gui");
  rimrafSync(vscodeGuiPath);
  fs.mkdirSync(vscodeGuiPath, { recursive: true });
  const vscodeCopyStart = Date.now();
  console.log(`[timer] Starting VSCode copy at ${new Date().toISOString()}`);
  await new Promise((resolve, reject) => {
    ncp("dist", vscodeGuiPath, (error) => {
      if (error) {
        console.log(
          "Error copying React app build to VSCode extension: ",
          error,
        );
        reject(error);
      } else {
        console.log("Copied gui build to VSCode extension");
        resolve();
      }
    });
  });
  console.log(
    `[timer] VSCode copy completed in ${Date.now() - vscodeCopyStart}ms`,
  );

  if (!fs.existsSync(path.join("dist", "assets", "index.js"))) {
    throw new Error("gui build did not produce index.js");
  }
  if (!fs.existsSync(path.join("dist", "assets", "index.css"))) {
    throw new Error("gui build did not produce index.css");
  }

  // Copy over native / wasm modules //
  process.chdir("../extensions/vscode");

  bundleAgentCli();

  fs.mkdirSync("bin", { recursive: true });

  // onnxruntime-node
  const onnxCopyStart = Date.now();
  console.log(
    `[timer] Starting onnxruntime copy at ${new Date().toISOString()}`,
  );
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/onnxruntime-node/bin"),
      path.join(__dirname, "../bin"),
      {
        dereference: true,
      },
      (error) => {
        if (error) {
          console.warn("[info] Error copying onnxruntime-node files", error);
          resolve();
          return;
        }
        resolve();
      },
    );
  });
  console.log(
    `[timer] onnxruntime copy completed in ${Date.now() - onnxCopyStart}ms`,
  );
  if (target) {
    // If building for production, only need the binaries for current platform
    try {
      if (!target.startsWith("darwin")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/darwin"));
      }
      if (!target.startsWith("linux")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/linux"));
      }
      if (!target.startsWith("win")) {
        rimrafSync(path.join(__dirname, "../bin/napi-v3/win32"));
      }

      // Also don't want to include cuda/shared/tensorrt binaries, they are too large
      if (target.startsWith("linux")) {
        const filesToRemove = [
          "libonnxruntime_providers_cuda.so",
          "libonnxruntime_providers_shared.so",
          "libonnxruntime_providers_tensorrt.so",
        ];
        filesToRemove.forEach((file) => {
          const filepath = path.join(
            __dirname,
            "../bin/napi-v3/linux/x64",
            file,
          );
          if (fs.existsSync(filepath)) {
            fs.rmSync(filepath);
          }
        });
      }
    } catch (e) {
      console.warn("[info] Error removing unused binaries", e);
    }
  }
  console.log("[info] Copied onnxruntime-node");

  // Keep the web runtime available as a genuine fallback if the native
  // binding cannot be loaded on a supported host.
  copyOnnxWasmFromNodeModules();

  // tree-sitter-wasm
  fs.mkdirSync("out", { recursive: true });

  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/tree-sitter-wasms/out"),
      path.join(__dirname, "../out/tree-sitter-wasms"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying tree-sitter-wasm files", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  const filesToCopy = [
    "../../../core/vendor/tree-sitter.wasm",
    "../../../core/llm/llamaTokenizerWorkerPool.mjs",
    "../../../core/llm/llamaTokenizer.mjs",
    "../../../core/llm/tiktokenWorkerPool.mjs",
    "../../../core/util/start_ollama.sh",
  ];

  for (const f of filesToCopy) {
    fs.copyFileSync(
      path.join(__dirname, f),
      path.join(__dirname, "..", "out", path.basename(f)),
    );
    console.log(`[info] Copied ${path.basename(f)}`);
  }

  // tree-sitter tag query files
  // ncp(
  //   path.join(
  //     __dirname,
  //     "../../../core/node_modules/llm-code-highlighter/dist/tag-qry",
  //   ),
  //   path.join(__dirname, "../out/tag-qry"),
  //   (error) => {
  //     if (error)
  //       console.warn("Error copying code-highlighter tag-qry files", error);
  //   },
  // );

  // textmate-syntaxes
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../textmate-syntaxes"),
      path.join(__dirname, "../gui/textmate-syntaxes"),
      (error) => {
        if (error) {
          console.warn("[error] Error copying textmate-syntaxes", error);
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  const lancedbPackagesByTarget = {
    "darwin-arm64": "@lancedb/vectordb-darwin-arm64",
    "darwin-x64": "@lancedb/vectordb-darwin-x64",
    "linux-arm64": "@lancedb/vectordb-linux-arm64-gnu",
    "linux-x64": "@lancedb/vectordb-linux-x64-gnu",
    "win32-x64": "@lancedb/vectordb-win32-x64-msvc",
    "win32-arm64": "@lancedb/vectordb-win32-arm64-msvc",
  };

  const packageToInstall = lancedbPackagesByTarget[target];
  let packageDirName;
  let expectedPackagePath;
  if (packageToInstall) {
    packageDirName = packageToInstall.split("/").pop();
    const packageSpecToInstall = resolveLanceDbPackageSpec(packageToInstall);
    expectedPackagePath = path.join(
      __dirname,
      "..",
      "node_modules",
      "@lancedb",
      packageDirName,
    );
    const expectedPackageIndexPath = path.join(
      expectedPackagePath,
      "index.node",
    );

    if (!fs.existsSync(expectedPackageIndexPath)) {
      console.log(
        `[info] Installing LanceDB binary for ${target}: ${packageSpecToInstall}`,
      );
      await installAndCopyNodeModules(packageSpecToInstall, "@lancedb");
      if (!fs.existsSync(expectedPackageIndexPath)) {
        throw new Error(
          `Failed to install LanceDB binary at ${expectedPackageIndexPath}`,
        );
      }
    } else {
      console.log(
        `[info] LanceDB binary already present for ${target} at ${expectedPackageIndexPath}`,
      );
    }
  } else {
    console.warn(
      `[warn] No LanceDB package mapping found for target ${target}`,
    );
  }

  if (!skipInstalls) {
    await copySqlite(target);
  } else {
    console.log("[info] Skipping sqlite download because SKIP_INSTALLS=true");
  }

  console.log("[info] Copying sqlite node binding from core");
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/sqlite3/build"),
      path.join(__dirname, "../out/build"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying sqlite3 files", error);
          resolve();
          return;
        } else {
          resolve();
        }
      },
    );
  });

  // Copied here as well for the VS Code test suite
  await new Promise((resolve, reject) => {
    ncp(
      path.join(__dirname, "../../../core/node_modules/sqlite3/build"),
      path.join(__dirname, "../out"),
      { dereference: true },
      (error) => {
        if (error) {
          console.warn("[error] Error copying sqlite3 files", error);
          resolve();
          return;
        } else {
          resolve();
        }
      },
    );
  });

  // Copy node_modules for pre-built binaries
  const NODE_MODULES_TO_COPY = ["@lancedb", "@vscode/ripgrep", "workerpool"];

  fs.mkdirSync("out/node_modules", { recursive: true });

  await Promise.all(
    NODE_MODULES_TO_COPY.map(
      (mod) =>
        new Promise((resolve, reject) => {
          fs.mkdirSync(`out/node_modules/${mod}`, { recursive: true });
          ncp(
            `node_modules/${mod}`,
            `out/node_modules/${mod}`,
            { dereference: true },
            function (error) {
              if (error) {
                console.error(`[error] Error copying ${mod}`, error);
                reject(error);
              } else {
                console.log(`[info] Copied ${mod}`);
                resolve();
              }
            },
          );
        }),
    ),
  );

  console.log(`[info] Copied ${NODE_MODULES_TO_COPY.join(", ")}`);

  bundleVoiceTranscriptionDependencies(target);

  if (packageDirName && expectedPackagePath) {
    const expectedOutPackagePath = path.join(
      __dirname,
      "..",
      "out",
      "node_modules",
      "@lancedb",
      packageDirName,
    );
    const expectedOutIndexPath = path.join(
      expectedOutPackagePath,
      "index.node",
    );
    if (!fs.existsSync(expectedOutIndexPath)) {
      rimrafSync(expectedOutPackagePath);
      fs.mkdirSync(expectedOutPackagePath, { recursive: true });
      fs.cpSync(expectedPackagePath, expectedOutPackagePath, {
        recursive: true,
        dereference: true,
      });
      console.log(`[info] Copied LanceDB binary to ${expectedOutPackagePath}`);
    } else {
      console.log(
        `[info] LanceDB binary already copied at ${expectedOutIndexPath}`,
      );
    }
  }

  // Copy over any worker files
  fs.cpSync(
    "node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js",
    "out/xhr-sync-worker.js",
  );

  // Validate the all of the necessary files are present
  validateFilesPresent([
    // Queries used to create the index for @code context provider
    "tree-sitter/code-snippet-queries/c_sharp.scm",

    // Queries used for @outline and @highlights context providers
    "tag-qry/tree-sitter-c_sharp-tags.scm",

    // onnx runtime bindngs
    `bin/napi-v3/${os}/${arch}/onnxruntime_binding.node`,
    `bin/napi-v3/${os}/${arch}/${
      isMacTarget
        ? "libonnxruntime.1.14.0.dylib"
        : isLinuxTarget
          ? "libonnxruntime.so.1.14.0"
          : "onnxruntime.dll"
    }`,
    "out/dist/ort-wasm-simd-threaded.wasm",

    // Code/styling for the sidebar
    "gui/assets/index.js",
    "gui/assets/index.css",

    // Tutorial
    "media/move-chat-panel-right.md",
    "qivryn_tutorial.py",
    "config_schema.json",

    // Embeddings model
    "models/all-MiniLM-L6-v2/config.json",
    "models/all-MiniLM-L6-v2/special_tokens_map.json",
    "models/all-MiniLM-L6-v2/tokenizer_config.json",
    "models/all-MiniLM-L6-v2/tokenizer.json",
    "models/all-MiniLM-L6-v2/vocab.txt",
    "models/all-MiniLM-L6-v2/onnx/model_quantized.onnx",

    // node_modules (it's a bit confusing why this is necessary)
    `node_modules/@vscode/ripgrep/bin/rg${exe}`,

    // out directory (where the extension.js lives)
    // "out/extension.js", This is generated afterward by vsce
    // web-tree-sitter
    "out/tree-sitter.wasm",
    // Worker required by jsdom
    "out/xhr-sync-worker.js",
    // Self-contained runtime used by the Agents workspace
    "out/cli/qivryn.js",
    "out/cli/index.js",
    "out/cli/package.json",
    "out/cli/xhr-sync-worker.js",
    // Provider configuration installed on first activation
    "out/default-config.yaml",
    // SQLite3 Node native module
    "out/build/Release/node_sqlite3.node",

    // out/node_modules (to be accessed by extension.js)
    `out/node_modules/@vscode/ripgrep/bin/rg${exe}`,
    "out/node_modules/sharp/package.json",
    packagedSharpBinaryPath(),
    `out/node_modules/@lancedb/vectordb-${target}${isWinTarget ? "-msvc" : ""}${isLinuxTarget ? "-gnu" : ""}/index.node`,
  ]);

  console.log(
    `[timer] Prepackage completed in ${Date.now() - startTime}ms - finished at ${new Date().toISOString()}`,
  );
  process.exit(0);
})();
