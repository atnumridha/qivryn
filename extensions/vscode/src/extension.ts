/**
 * This is the entry point for the extension.
 */

import { setupCa } from "core/util/ca";
import * as vscode from "vscode";

export { default as buildTimestamp } from "./.buildTimestamp";

async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  await setupCa();
  const { activateExtension } = await import("./activation/activate");
  return await activateExtension(context);
}

export function activate(context: vscode.ExtensionContext) {
  return dynamicImportAndActivate(context).catch((e) => {
    console.log("Error activating extension: ", e);
    vscode.window
      .showWarningMessage(
        "Error activating the Qivryn extension.",
        "View Logs",
        "Retry Extension Host",
        "Reload Window",
      )
      .then((selection) => {
        if (selection === "View Logs") {
          vscode.commands.executeCommand("qivryn.viewLogs");
        } else if (selection === "Retry Extension Host") {
          vscode.commands.executeCommand(
            "workbench.action.restartExtensionHost",
          );
        } else if (selection === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  });
}

export function deactivate() {}
