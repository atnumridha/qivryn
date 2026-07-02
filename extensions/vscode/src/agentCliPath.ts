import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the self-contained CLI shipped with the extension. The second path
 * keeps extension development working before a VSIX has been assembled.
 */
export function resolveAgentCliPath(extensionPath: string): string | undefined {
  const candidates = [
    path.join(extensionPath, "out", "cli", "cn.js"),
    path.resolve(extensionPath, "..", "cli", "dist", "cn.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
