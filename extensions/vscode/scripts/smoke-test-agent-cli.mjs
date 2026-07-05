import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 2;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseRunListOutput(output) {
  for (
    let index = output.indexOf("{");
    index >= 0;
    index = output.indexOf("{", index + 1)
  ) {
    try {
      const parsed = JSON.parse(output.slice(index));
      if (Array.isArray(parsed?.runs)) return parsed;
    } catch {
      // A dependency may have logged before the structured CLI payload.
    }
  }
  throw new Error(`Packaged CLI did not return a JSON run list:\n${output}`);
}

export function assertDaemonHealth(health) {
  if (health?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `Expected daemon protocol ${PROTOCOL_VERSION}, received ${String(health?.protocolVersion)}`,
    );
  }
  if (health?.capabilities?.local !== true) {
    throw new Error("Packaged daemon did not advertise local execution");
  }
  if (health?.capabilities?.persistent !== true) {
    throw new Error("Packaged daemon did not advertise persistent storage");
  }
}

export function selectVsix(directory, explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".vsix"))
    .map((entry) => {
      const filepath = path.join(directory, entry.name);
      return { filepath, modified: fs.statSync(filepath).mtimeMs };
    })
    .sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) {
    throw new Error(`No VSIX was found in ${directory}`);
  }
  return candidates[0].filepath;
}

function extractVsix(vsixPath, destination) {
  const command = process.platform === "win32" ? "tar" : "unzip";
  const args =
    process.platform === "win32"
      ? ["-xf", vsixPath, "-C", destination]
      : ["-q", "-o", vsixPath, "-d", destination];
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `Unable to extract ${vsixPath}:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

async function waitForDescriptor(filepath, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged daemon exited before it became ready (${child.exitCode})`,
      );
    }
    try {
      return JSON.parse(await readFile(filepath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for the packaged daemon descriptor");
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopDaemon(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 5_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 5_000);
}

async function waitForRemoval(filepath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(filepath)) return;
    await sleep(100);
  }
  throw new Error(`Daemon descriptor was not removed: ${filepath}`);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function smokeTestPackagedAgentCli({ vsixPath, vsixDirectory }) {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "qivryn-packaged-agent-"),
  );
  const extractionDirectory = path.join(temporaryRoot, "vsix");
  const qivrynHome = path.join(temporaryRoot, "home");
  fs.mkdirSync(extractionDirectory, { recursive: true });

  let daemon;
  let daemonLogs = "";
  try {
    const selectedVsix = selectVsix(vsixDirectory, vsixPath);
    extractVsix(selectedVsix, extractionDirectory);
    const cliPath = path.join(
      extractionDirectory,
      "extension",
      "out",
      "cli",
      "qivryn.js",
    );
    if (!fs.existsSync(cliPath)) {
      throw new Error(`Packaged Qivryn CLI is missing: ${cliPath}`);
    }

    const env = {
      ...process.env,
      QIVRYN_GLOBAL_DIR: qivrynHome,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
    const list = spawnSync(
      process.execPath,
      [cliPath, "agents", "list", "--json"],
      { env, encoding: "utf8", timeout: 30_000 },
    );
    if (list.status !== 0) {
      throw new Error(
        `Packaged agent list failed:\n${list.stdout ?? ""}${list.stderr ?? ""}`,
      );
    }
    parseRunListOutput(list.stdout ?? "");

    const token = randomBytes(24).toString("hex");
    daemon = spawn(process.execPath, [cliPath, "agents", "daemon"], {
      env: { ...env, QIVRYN_AGENT_DAEMON_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    daemon.stdout?.on("data", (chunk) => {
      daemonLogs = `${daemonLogs}${chunk}`.slice(-20_000);
    });
    daemon.stderr?.on("data", (chunk) => {
      daemonLogs = `${daemonLogs}${chunk}`.slice(-20_000);
    });

    const descriptorPath = path.join(qivrynHome, "agents", "daemon.json");
    const descriptor = await waitForDescriptor(descriptorPath, daemon);
    if (descriptor.token !== token || descriptor.pid !== daemon.pid) {
      throw new Error(
        "Packaged daemon descriptor identity did not match its process",
      );
    }
    const response = await fetch(`${descriptor.baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(
        `Packaged daemon health returned HTTP ${response.status}`,
      );
    }
    assertDaemonHealth(await response.json());
    await stopDaemon(daemon);
    await waitForRemoval(descriptorPath);

    return {
      vsixPath: selectedVsix,
      cliPath,
      protocolVersion: PROTOCOL_VERSION,
    };
  } catch (error) {
    if (daemonLogs)
      error.message = `${error.message}\nDaemon output:\n${daemonLogs}`;
    throw error;
  } finally {
    if (daemon) await stopDaemon(daemon);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  const result = await smokeTestPackagedAgentCli({
    vsixPath: readOption("--vsix"),
    vsixDirectory: path.resolve(readOption("--vsix-dir") ?? process.cwd()),
  });
  console.log(
    `Packaged Qivryn agent runtime passed (protocol ${result.protocolVersion}): ${result.vsixPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
