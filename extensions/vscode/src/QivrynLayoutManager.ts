import * as vscode from "vscode";
import {
  BUILT_IN_LAYOUTS,
  createCustomLayout,
  restoreSavedLayouts,
  saveCustomLayout,
  type QivrynLayoutPreset,
  type QivrynLayoutSnapshot,
} from "./layoutPresets";

const CUSTOM_KEY = "qivryn.customLayouts";
const ACTIVE_KEY = "qivryn.activeLayout";

export interface QivrynLayoutManagerOptions {
  nativeAgentSessions?: boolean;
}

export class QivrynLayoutManager {
  private contextKeyReaderAvailable: boolean | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly options: QivrynLayoutManagerOptions = {},
  ) {}

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
      { title: "Qivryn Layout", placeHolder: "Choose a workspace layout" },
    );
    if (selected) await this.apply(selected.preset);
  }

  async saveCurrent(): Promise<void> {
    const active = this.context.workspaceState.get<QivrynLayoutPreset>(
      ACTIVE_KEY,
      BUILT_IN_LAYOUTS[0],
    );
    const name = await vscode.window.showInputBox({
      title: "Save Qivryn Layout",
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

  async restoreActive(useAgentDefault = false): Promise<void> {
    const hasQivrynEditor = vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) =>
        (tab.input as { viewType?: string } | undefined)?.viewType?.endsWith(
          "qivryn.qivrynGUIView",
        ),
      ),
    );
    if (!useAgentDefault && hasQivrynEditor) return;

    const active =
      this.context.workspaceState.get<QivrynLayoutPreset>(ACTIVE_KEY) ??
      (useAgentDefault ? BUILT_IN_LAYOUTS[0] : undefined);
    if (active) await this.apply(active);
  }

  async apply(preset: QivrynLayoutPreset): Promise<void> {
    if (preset.custom && preset.snapshot) {
      await this.applySnapshot(preset.snapshot);
      await this.context.workspaceState.update(ACTIVE_KEY, preset);
      await this.updateLayoutContext(preset);
      return;
    }
    if (preset.builtIn !== "zen") await this.ensureZen(false);
    switch (preset.builtIn) {
      case "agent":
        await this.applyAgentLayout();
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
        await vscode.commands.executeCommand("qivryn.openBrowserWorkspace");
        break;
      case "maximized-chat":
        await vscode.commands.executeCommand(
          "qivryn.openInNewWindow",
          "/",
          false,
        );
        break;
    }
    await this.context.workspaceState.update(ACTIVE_KEY, preset);
    await this.updateLayoutContext(preset);
  }

  private async applyAgentLayout(): Promise<void> {
    if (this.options.nativeAgentSessions) {
      try {
        const restored = await vscode.commands.executeCommand<boolean>(
          "qivryn.restoreNativeAgentSurface",
        );
        if (restored) return;
      } catch (error) {
        console.warn(
          "[Qivryn] Native Agent layout restore failed; using the React fallback",
          error,
        );
      }
    }

    await vscode.commands.executeCommand("workbench.action.closePanel");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    try {
      await vscode.commands.executeCommand("workbench.view.extension.qivryn");
      await vscode.commands.executeCommand(
        "workbench.action.focusAuxiliaryBar",
      );
      await vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
      // VS Code can report the contributed container as visible before its
      // webview has replaced the previously active auxiliary-bar view.
      await new Promise((resolve) => setTimeout(resolve, 75));
      await vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
    } catch {
      await vscode.commands.executeCommand(
        "qivryn.openInNewWindow",
        "/",
        false,
        false,
      );
    }
    try {
      await vscode.commands.executeCommand("qivryn.closeRestoredAgentEditors");
    } catch {}
  }

  private async captureSnapshot(): Promise<QivrynLayoutSnapshot> {
    const [sidebarVisible, auxiliaryBarVisible, panelVisible, zenMode] =
      await Promise.all([
        this.readContextKey("sideBarVisible"),
        this.readContextKey("auxiliaryBarVisible"),
        this.readContextKey("panelVisible"),
        this.readContextKey("inZenMode"),
      ]);
    return {
      sidebarVisible: sidebarVisible === true,
      auxiliaryBarVisible: auxiliaryBarVisible === true,
      panelVisible: panelVisible === true,
      zenMode: zenMode === true,
    };
  }

  private async applySnapshot(snapshot: QivrynLayoutSnapshot): Promise<void> {
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
    const current = await this.readContextKey(contextKey);
    if (current === undefined) {
      const explicitCommand = {
        sideBarVisible: enabled
          ? "workbench.action.focusSideBar"
          : "workbench.action.closeSidebar",
        auxiliaryBarVisible: enabled
          ? "workbench.action.focusAuxiliaryBar"
          : "workbench.action.closeAuxiliaryBar",
        panelVisible: enabled
          ? "workbench.action.focusPanel"
          : "workbench.action.closePanel",
      }[contextKey];
      if (explicitCommand) {
        await vscode.commands.executeCommand(explicitCommand);
      }
      return;
    }
    if (current !== enabled) await vscode.commands.executeCommand(command);
  }

  private async ensureZen(enabled: boolean): Promise<void> {
    const current = await this.readContextKey("inZenMode");
    if (current === undefined) {
      await vscode.commands.executeCommand(
        enabled
          ? "workbench.action.toggleZenMode"
          : "workbench.action.exitZenMode",
      );
      return;
    }
    if ((enabled && current !== true) || (!enabled && current === true)) {
      await vscode.commands.executeCommand("workbench.action.toggleZenMode");
    }
  }

  private async readContextKey(key: string): Promise<boolean | undefined> {
    if (this.contextKeyReaderAvailable === undefined) {
      const commands = await vscode.commands.getCommands(true);
      this.contextKeyReaderAvailable = commands.includes("getContextKeyValue");
    }
    if (!this.contextKeyReaderAvailable) return undefined;
    return vscode.commands.executeCommand<boolean | undefined>(
      "getContextKeyValue",
      key,
    );
  }

  private async updateLayoutContext(preset: QivrynLayoutPreset): Promise<void> {
    await Promise.all([
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.currentLayout",
        preset.builtIn,
      ),
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.composerLocation",
        preset.builtIn === "maximized-chat"
          ? "promptBar"
          : preset.builtIn === "agent" && this.options.nativeAgentSessions
            ? "pane"
            : "editor",
      ),
    ]);
  }
}
