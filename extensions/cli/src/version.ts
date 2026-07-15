import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import node_machine_id from "node-machine-id";

import { logger } from "./util/logger.js";

export function getVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  for (const packageJsonPath of [
    join(__dirname, "package.json"),
    join(__dirname, "../package.json"),
  ]) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof packageJson.version === "string") {
        return packageJson.version;
      }
    } catch {
      // Try the next package boundary. Bundled VSIX and npm layouts differ.
    }
  }
  console.warn("Warning: Could not read version from package.json");
  return "unknown";
}

function getEventUserId(): string {
  return node_machine_id.machineIdSync();
}

const QIVRYN_INFO_URL = "https://api.qivryn.ai/qivryn/info";
const QIVRYN_NPM_URL = "https://registry.npmjs.org/@qivryn%2Fcli/latest";

const readStringProperty = (
  value: unknown,
  property: string,
): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : null;
};

export const extractLatestNpmVersion = (metadata: unknown): string | null => {
  const version = readStringProperty(metadata, "version");
  return version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : null;
};

async function fetchLatestVersion(
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const id = getEventUserId();
    const response = await fetch(
      `${QIVRYN_INFO_URL}?id=${encodeURIComponent(id)}`,
      { signal },
    );
    if (response.ok) {
      const version = readStringProperty(await response.json(), "version");
      if (version) return version;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    logger?.debug("Could not fetch the latest version from api.qivryn.ai");
  }

  try {
    const response = await fetch(QIVRYN_NPM_URL, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return extractLatestNpmVersion(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return null;
    logger?.debug("Could not fetch the latest CLI version from npm");
    return null;
  }
}

// Singleton to cache the latest version result
let latestVersionCache: Promise<string | null> | null = null;

export async function getLatestVersion(
  signal?: AbortSignal,
): Promise<string | null> {
  // Return cached promise if it exists
  if (latestVersionCache) {
    return latestVersionCache;
  }

  latestVersionCache = fetchLatestVersion(signal);

  return latestVersionCache;
}

getLatestVersion()
  .then((version) => {
    if (version) {
      logger?.info(`Latest version: ${version}`);
    }
  })
  .catch((error) => {
    logger?.debug(
      `Warning: Could not fetch latest version from api.qivryn.ai: ${error}`,
    );
  });

export function compareVersions(
  current: string,
  latest: string,
): "newer" | "same" | "older" {
  if (current === "unknown" || latest === "unknown") {
    return "same";
  }

  // Simple semantic version comparison
  const parseVersion = (version: string) => {
    const parts = version
      .replace(/^v/, "")
      .split(".")
      .map((part) => parseInt(part, 10));
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };

  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  if (currentParts.major > latestParts.major) return "newer";
  if (currentParts.major < latestParts.major) return "older";
  if (currentParts.minor > latestParts.minor) return "newer";
  if (currentParts.minor < latestParts.minor) return "older";
  if (currentParts.patch > latestParts.patch) return "newer";
  if (currentParts.patch < latestParts.patch) return "older";

  return "same";
}
