#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.local.mosfs_chrome_agent";
const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const out = {
    chromeExtensionId: "",
    chromeUserDataDirs: [],
    autoDetectChromeProfiles: true,
    skipChrome: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--chrome-extension-id") {
      out.chromeExtensionId = argv[++i] || "";
    } else if (arg === "--chrome-user-data-dir") {
      out.chromeUserDataDirs.push(argv[++i] || "");
    } else if (arg === "--no-auto-detect-chrome-profiles") {
      out.autoDetectChromeProfiles = false;
    } else if (arg === "--skip-chrome") {
      out.skipChrome = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function usage() {
  return `Usage:
  npm run install:native-hosts -- --chrome-extension-id <unpacked-extension-id>

Options:
  --chrome-extension-id <id>     Required for Chrome native messaging.
  --chrome-user-data-dir <dir>   Also install under a custom Chrome --user-data-dir.
  --no-auto-detect-chrome-profiles
                                  Do not scan running Chrome processes for --user-data-dir.
  --skip-chrome                  Skip Chrome manifest installation.
`;
}

async function installChromeManifest(dir, chromeExtensionId, wrapper) {
  await mkdir(dir, { recursive: true });
  const chromeManifest = {
    name: HOST_NAME,
    description: "MOSFS Chrome Agent native messaging host",
    path: wrapper,
    type: "stdio",
    allowed_origins: [`chrome-extension://${chromeExtensionId}/`],
  };
  const chromeManifestFile = path.join(dir, `${HOST_NAME}.json`);
  await writeFile(chromeManifestFile, JSON.stringify(chromeManifest, null, 2), "utf8");
  console.error(`[mosfs-chrome-agent] Chrome native host: ${chromeManifestFile}`);
}

async function detectRunningChromeUserDataDirs() {
  try {
    const { stdout } = await execFileAsync("ps", ["aux"], { maxBuffer: 10 * 1024 * 1024 });
    const dirs = new Set();
    for (const line of stdout.split("\n")) {
      if (!line.includes("Google Chrome") || !line.includes("--user-data-dir=")) continue;
      const match = line.match(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/);
      const dir = match?.[1] || match?.[2] || match?.[3];
      if (dir) dirs.add(dir);
    }
    return [...dirs];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const wrapper = path.join(projectRoot, "bin", "mosfs-chrome-agent-native-host");
  const shellWrapper = path.join(projectRoot, "bin", "mosfs-chrome-agent-native-host.sh");
  const nativeWrapperSource = path.join(projectRoot, "bin", "mosfs-chrome-agent-native-host.c");
  const nativeEntry = path.join(projectRoot, "src", "native-host", "index.mjs");
  const logFile = "/Users/amridha/Documents/MOS_Automations/artifacts/mosfs-chrome-agent/logs/native-host-wrapper.log";

  await mkdir(path.dirname(wrapper), { recursive: true });
  await writeFile(shellWrapper, `#!/bin/sh\nexec "${process.execPath}" "${nativeEntry}" 2>> "${logFile}"\n`, "utf8");
  await chmod(shellWrapper, 0o755);
  await writeFile(nativeWrapperSource, nativeWrapperProgram({ nodePath: process.execPath, nativeEntry, logFile }), "utf8");
  try {
    await execFileAsync("cc", [nativeWrapperSource, "-O2", "-o", wrapper], { maxBuffer: 1024 * 1024 });
  } catch (error) {
    await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${nativeEntry}" 2>> "${logFile}"\n`, "utf8");
    console.error(`[mosfs-chrome-agent] Native C wrapper compile failed, using shell wrapper: ${error.message}`);
  }
  await chmod(wrapper, 0o755);

  if (!args.skipChrome) {
    if (!args.chromeExtensionId) {
      throw new Error("Chrome install requires --chrome-extension-id from chrome://extensions after loading unpacked.");
    }
    const chromeManifestDir = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
    );
    await installChromeManifest(chromeManifestDir, args.chromeExtensionId, wrapper);

    const detectedDirs = args.autoDetectChromeProfiles ? await detectRunningChromeUserDataDirs() : [];
    const customDirs = [...new Set([...args.chromeUserDataDirs, ...detectedDirs].filter(Boolean))];
    for (const userDataDir of customDirs) {
      await installChromeManifest(path.join(userDataDir, "NativeMessagingHosts"), args.chromeExtensionId, wrapper);
    }
  }

  console.error(`[mosfs-chrome-agent] Native wrapper: ${wrapper}`);
  console.error(`[mosfs-chrome-agent] Native host log: ${logFile}`);
}

function cString(value) {
  return JSON.stringify(String(value));
}

function nativeWrapperProgram({ nodePath, nativeEntry, logFile }) {
  return `#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
  int fd = open(${cString(logFile)}, O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd >= 0) {
    dup2(fd, STDERR_FILENO);
    dprintf(fd, "[native-wrapper] started pid=%d\\n", getpid());
  }
  execl(${cString(nodePath)}, "node", ${cString(nativeEntry)}, (char *)0);
  perror("exec node failed");
  return 127;
}
`;
}

main().catch((error) => {
  console.error(`[mosfs-chrome-agent] ERROR: ${error.message}`);
  process.exitCode = 1;
});
