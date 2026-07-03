import * as fs from "fs";
import * as path from "path";

import { getQivrynGlobalPath, setConfigFilePermissions } from "core/util/paths";
import * as YAML from "yaml";

export type BundledConfigInstallResult =
  | "installed"
  | "replaced-empty-default"
  | "preserved-existing"
  | "missing-bundle";

function isEmptyGeneratedConfig(contents: string): boolean {
  if (contents.trim() === "") {
    return true;
  }

  try {
    const config = YAML.parse(contents) as Record<string, unknown> | null;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return false;
    }

    const keys = Object.keys(config).sort();
    return (
      keys.join(",") === "models,name,schema,version" &&
      config.name === "Main Config" &&
      config.version === "1.0.0" &&
      config.schema === "v1" &&
      Array.isArray(config.models) &&
      config.models.length === 0
    );
  } catch {
    // Invalid user configuration must be left in place so it can be repaired.
    return false;
  }
}

export function installBundledConfig(
  bundledConfigPath: string,
  configDirectory = getQivrynGlobalPath(),
): BundledConfigInstallResult {
  if (!fs.existsSync(bundledConfigPath)) {
    return "missing-bundle";
  }

  fs.mkdirSync(configDirectory, { recursive: true });
  const yamlPath = path.join(configDirectory, "config.yaml");
  const jsonPath = path.join(configDirectory, "config.json");

  // Continue to respect the legacy JSON config when it is the user's primary
  // configuration. Installing YAML beside it would silently take precedence.
  if (!fs.existsSync(yamlPath) && fs.existsSync(jsonPath)) {
    return "preserved-existing";
  }

  let result: BundledConfigInstallResult = "installed";
  if (fs.existsSync(yamlPath)) {
    const existingContents = fs.readFileSync(yamlPath, "utf8");
    if (!isEmptyGeneratedConfig(existingContents)) {
      return "preserved-existing";
    }
    result = "replaced-empty-default";
  }

  fs.copyFileSync(bundledConfigPath, yamlPath);
  setConfigFilePermissions(yamlPath);
  return result;
}
