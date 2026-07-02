import * as vscode from "vscode";
import {
  BUILT_IN_LAYOUTS,
  createCustomLayout,
  restoreSavedLayouts,
  saveCustomLayout,
  type ContinueLayoutPreset,
  type ContinueLayoutSnapshot,
} from "./layoutPresets";

const CUSTOM_KEY = "continue.customLayouts";
const ACTIVE_KEY = "continue.activeLayout";

export class ContinueLayoutManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async chooseAndApply(): Promise<void> {
    const custom = restoreSavedLayouts(
      this.context.workspaceState.get<unknown>(CUSTOM_KEY, []),
    );
    const selected = await vscode.window.showQuickPick(
      [...BUILT_IN_LAYOUTS, ...custom].map((preset) => ({
        label: preset.label,
        description: preset.custom ? "Workspace layout" : "Built in",
        preset,
      })),
      { title: "Continue Layout", placeHolder: "Choose a workspace layout" },
    );
    if (selected) await this.apply(selected.preset);
  }

  async saveCurrent(): Promise<void> {
    const active = this.context.workspaceState.get<ContinueLayoutPreset>(
      ACTIVE_KEY,
      BUILT_IN_LAYOUTS[0],
    );
    const name = await vscode.window.showInputBox({
      title: "Save Continue Layout",
      prompt: `Save the current ${active.label} arrangement for this workspace`,
      placeHolder: "Layout name",
    });
    if (!name) return;
    const preset = createCustomLayout(
      name,
      active,
      await this.captureSnapshot(),
    );
    const current = restoreSavedLayouts(
      this.context.workspaceState.get<unknown>(CUSTOM_KEY, []),
    );
    await this.context.workspaceState.update(
      CUSTOM_KEY,
      saveCustomLayout(current, preset),
    );
    await vscode.window.showInformationMessage(
      `Saved layout “${preset.label}”`,
    );
  }

  async restoreActive(): Promise<void> {
    const active =
      this.context.workspaceState.get<ContinueLayoutPreset>(ACTIVE_KEY);
    if (active) await this.apply(active);
  }

  async apply(preset: ContinueLayoutPreset): Promise<void> {
    if (preset.custom && preset.snapshot) {
      await this.applySnapshot(preset.snapshot);
      await this.context.workspaceState.update(ACTIVE_KEY, preset);
      return;
    }
    if (preset.builtIn !== "zen") await this.ensureZen(false);
    switch (preset.builtIn) {
      case "agent":
        await vscode.commands.executeCommand("workbench.action.closePanel");
        await vscode.commands.executeCommand(
          "continue.navigateTo",
          "/agents",
          false,
        );
        break;
      case "editor":
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
        await vscode.commands.executeCommand(
          "workbench.action.closeAuxiliaryBar",
        );
        await vscode.commands.executeCommand("workbench.action.closePanel");
        await vscode.commands.executeCommand(
          "workbench.action.focusActiveEditorGroup",
        );
        break;
      case "zen":
        await this.ensureZen(true);
        break;
      case "browser":
        await vscode.commands.executeCommand(
          "continue.openInNewWindow",
          "/browser",
        );
        break;
      case "maximized-chat":
        await vscode.commands.executeCommand("continue.openInNewWindow", "/");
        break;
    }
    await this.context.workspaceState.update(ACTIVE_KEY, preset);
  }

  private async captureSnapshot(): Promise<ContinueLayoutSnapshot> {
    const read = (key: string) =>
      vscode.commands.executeCommand<boolean | undefined>(
        "getContextKeyValue",
        key,
      );
    const [sidebarVisible, auxiliaryBarVisible, panelVisible, zenMode] =
      await Promise.all([
        read("sideBarVisible"),
        read("auxiliaryBarVisible"),
        read("panelVisible"),
        read("inZenMode"),
      ]);
    return {
      sidebarVisible: sidebarVisible === true,
      auxiliaryBarVisible: auxiliaryBarVisible === true,
      panelVisible: panelVisible === true,
      zenMode: zenMode === true,
    };
  }

  private async applySnapshot(snapshot: ContinueLayoutSnapshot): Promise<void> {
    await this.ensureZen(snapshot.zenMode);
    if (snapshot.zenMode) return;
    await this.ensureVisibility(
      "sideBarVisible",
      snapshot.sidebarVisible,
      "workbench.action.toggleSidebarVisibility",
    );
    await this.ensureVisibility(
      "auxiliaryBarVisible",
      snapshot.auxiliaryBarVisible,
      "workbench.action.toggleAuxiliaryBar",
    );
    await this.ensureVisibility(
      "panelVisible",
      snapshot.panelVisible,
      "workbench.action.togglePanel",
    );
  }

  private async ensureVisibility(
    contextKey: string,
    enabled: boolean,
    command: string,
  ): Promise<void> {
    const current = await vscode.commands.executeCommand<boolean | undefined>(
      "getContextKeyValue",
      contextKey,
    );
    if (current !== enabled) await vscode.commands.executeCommand(command);
  }

  private async ensureZen(enabled: boolean): Promise<void> {
    const current = await vscode.commands.executeCommand<boolean | undefined>(
      "getContextKeyValue",
      "inZenMode",
    );
    if ((enabled && current !== true) || (!enabled && current === true)) {
      await vscode.commands.executeCommand("workbench.action.toggleZenMode");
    }
  }
}
