import fs from "fs";

import { getQivrynGlobalPath } from "core/util/paths";
import { ExtensionContext } from "vscode";

/**
 * Clear all Qivryn-related artifacts to simulate a brand new user
 */
export function cleanSlate(context: ExtensionContext) {
  // Commented just to be safe
  // // Remove ~/.qivryn
  // const qivrynPath = getQivrynGlobalPath();
  // if (fs.existsSync(qivrynPath)) {
  //   fs.rmSync(qivrynPath, { recursive: true, force: true });
  // }
  // // Clear extension's globalState
  // context.globalState.keys().forEach((key) => {
  //   context.globalState.update(key, undefined);
  // });
}
