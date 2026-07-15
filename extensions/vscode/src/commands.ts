/* eslint-disable @typescript-eslint/naming-convention */
import {
  createAgentDiagnosticReport,
  FileAgentStore,
  generateCommitMessage,
} from "@qivryn/agent-runtime";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyTerminalCommand } from "../../../packages/terminal-security/dist/index.js";

import { ContextMenuConfig, ILLM, ModelInstaller } from "core";
import { CompletionProvider } from "core/autocomplete/CompletionProvider";
import { ConfigHandler } from "core/config/ConfigHandler";
import { Core } from "core/core";
import { walkDirAsync } from "core/indexing/walkDir";
import { isModelInstaller } from "core/llm";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { EXTENSION_NAME } from "core/util/constants";
import { startLocalLemonade } from "core/util/lemonadeHelper";
import { startLocalOllama } from "core/util/ollamaHelper";
import {
  getConfigJsonPath,
  getConfigYamlPath,
  getQivrynGlobalPath,
  setConfigFilePermissions,
} from "core/util/paths";
import * as vscode from "vscode";
import * as YAML from "yaml";

import { convertJsonToYamlConfig } from "../../../packages/config-yaml/dist";

import { AgentScmGraphManager } from "./AgentScmGraphManager";
import { openAgentAttribution } from "./AiAttributionCodeLensProvider";
import {
  getAutocompleteStatusBarDescription,
  getAutocompleteStatusBarTitle,
  getNextEditMenuItems,
  getStatusBarStatus,
  getStatusBarStatusFromQuickPickItemLabel,
  handleNextEditToggle,
  isNextEditToggleLabel,
  quickPickStatusText,
  setupStatusBar,
  StatusBarStatus,
} from "./autocomplete/statusBar";
import { QivrynConsoleWebviewViewProvider } from "./QivrynConsoleWebviewViewProvider";
import { QivrynGUIWebviewViewProvider } from "./QivrynGUIWebviewViewProvider";
import { QivrynLayoutManager } from "./QivrynLayoutManager";
import { NativeReviewEditor } from "./native/NativeReviewEditor";
import { NativeBrowserEditor } from "./native/NativeBrowserEditor";
import { NativeTerminalJobs } from "./native/NativeTerminalJobs";
import { toAgentsWebviewRoute } from "./native/agentsWindowHandoff";
import { normalizeQivrynWebviewRoute } from "./native/webviewRoute";
import { processDiff } from "./diff/processDiff";
import { VerticalDiffManager } from "./diff/vertical/manager";
import { partialSuggestionCommand } from "./partialSuggestionAcceptance";
import EditDecorationManager from "./quickEdit/EditDecorationManager";
import { QuickEdit, QuickEditShowParams } from "./quickEdit/QuickEditQuickPick";
import {
  addCodeToContextFromRange,
  addEntireFileToContext,
  addHighlightedCodeToContext,
} from "./util/addCode";
import { Battery } from "./util/battery";
import { getMetaKeyLabel } from "./util/util";
import { openEditorAndRevealRange } from "./util/vscode";
import { VsCodeIde } from "./VsCodeIde";

let fullScreenPanel: vscode.WebviewPanel | undefined;
let fullScreenRecoverySessionId: string | undefined;

const CHAT_ROUTE = "/";

function focusFullScreenPanel(sidebar: QivrynGUIWebviewViewProvider): boolean {
  if (!fullScreenPanel) {
    return false;
  }

  // The provider's protocol is shared by the sidebar and panel. Restore the
  // fullscreen panel as its target before routing any command; otherwise a
  // menu action can be delivered to the hidden sidebar and make the active
  // chat look as though it collapsed.
  sidebar.webviewProtocol.webview = fullScreenPanel.webview;
  fullScreenPanel.reveal();
  return true;
}

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("qivryn.qivrynGUIView"),
  );
}

function waitForWebviewBoot(webview: vscode.Webview, timeoutMs = 1_000) {
  return new Promise<void>((resolve) => {
    let listener: vscode.Disposable | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      listener?.dispose();
      if (timer) clearTimeout(timer);
      resolve();
    };
    listener = webview.onDidReceiveMessage(finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

function focusGUI() {
  if (fullScreenPanel) {
    fullScreenPanel.reveal();
    return;
  }
  // Focus the Qivryn activity-bar launcher. It opens the dedicated Agent
  // workspace as soon as its view becomes visible.
  vscode.commands.executeCommand("workbench.view.extension.qivryn");
  vscode.commands.executeCommand("workbench.action.focusSideBar");
  vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
}

function hideGUI() {
  const fullScreenTab = getFullScreenTab();
  if (fullScreenTab) {
    // focus fullscreen
    fullScreenPanel?.dispose();
  } else {
    vscode.commands.executeCommand("workbench.action.closeSidebar");
  }
}

function waitForSidebarReady(
  sidebar: QivrynGUIWebviewViewProvider,
  timeout: number,
  interval: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkReadyState = () => {
      if (sidebar.isReady) {
        resolve(true);
      } else if (Date.now() - startTime >= timeout) {
        resolve(false); // Timed out
      } else {
        setTimeout(checkReadyState, interval);
      }
    };

    checkReadyState();
  });
}

// Copy everything over from extension.ts
const getCommandsMap: (
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: QivrynGUIWebviewViewProvider,
  consoleView: QivrynConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
  layoutManager: QivrynLayoutManager,
  agentScmGraphManager: AgentScmGraphManager,
) => { [command: string]: (...args: any) => any } = (
  ide,
  extensionContext,
  sidebar,
  consoleView,
  configHandler,
  verticalDiffManager,
  battery,
  quickEdit,
  core,
  editDecorationManager,
  layoutManager,
  agentScmGraphManager,
) => {
  const nativeReview = new NativeReviewEditor(extensionContext, core);
  const nativeBrowser = new NativeBrowserEditor(extensionContext, core);
  const nativeTerminalJobs = new NativeTerminalJobs(extensionContext, core);
  /**
   * Streams an inline edit to the vertical diff manager.
   *
   * This function retrieves the configuration, determines the appropriate model title,
   * increments the FTC count, and then streams an edit to the
   * vertical diff manager.
   *
   * @param  promptName - The key for the prompt in the context menu configuration.
   * @param  fallbackPrompt - The prompt to use if the configured prompt is not available.
   * @param  [range] - Optional. The range to edit if provided.
   * @returns
   */
  async function streamInlineEdit(
    promptName: keyof ContextMenuConfig,
    fallbackPrompt: string,
    range?: vscode.Range,
  ) {
    const { config } = await configHandler.loadConfig();
    if (!config) {
      throw new Error("Config not loaded");
    }

    const llm =
      config.selectedModelByRole.edit ?? config.selectedModelByRole.chat;

    if (!llm) {
      throw new Error("No edit or chat model selected");
    }

    void sidebar.webviewProtocol.request("incrementFtc", undefined);

    await verticalDiffManager.streamEdit({
      input:
        config.experimental?.contextMenuPrompts?.[promptName] ?? fallbackPrompt,
      llm,
      range,
      rulesToInclude: config.rules,
      isApply: false,
    });
  }

  return {
    "qivryn.acceptDiff": async (newFileUri?: string, streamId?: string) => {
      void processDiff(
        "accept",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },

    "qivryn.rejectDiff": async (newFileUri?: string, streamId?: string) => {
      void processDiff(
        "reject",
        sidebar,
        ide,
        core,
        verticalDiffManager,
        newFileUri,
        streamId,
      );
    },
    "qivryn.acceptVerticalDiffBlock": (fileUri?: string, index?: number) => {
      verticalDiffManager.acceptRejectVerticalDiffBlock(true, fileUri, index);
    },
    "qivryn.rejectVerticalDiffBlock": (fileUri?: string, index?: number) => {
      verticalDiffManager.acceptRejectVerticalDiffBlock(false, fileUri, index);
    },
    "qivryn.quickFix": async (
      range: vscode.Range,
      diagnosticMessage: string,
    ) => {
      const prompt = `Please explain the cause of this error and how to solve it: ${diagnosticMessage}`;

      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
    },
    "qivryn.defaultQuickAction": async (args: QuickEditShowParams) => {
      vscode.commands.executeCommand("qivryn.focusEdit", args);
    },
    "qivryn.customQuickActionSendToChat": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      addCodeToContextFromRange(range, sidebar.webviewProtocol, prompt);

      vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
    },
    "qivryn.customQuickActionStreamInlineEdit": async (
      prompt: string,
      range: vscode.Range,
    ) => {
      streamInlineEdit("docstring", prompt, range);
    },
    "qivryn.codebaseForceReIndex": async () => {
      core.invoke("index/forceReIndex", undefined);
    },
    "qivryn.rebuildCodebaseIndex": async () => {
      core.invoke("index/forceReIndex", { shouldClearIndexes: true });
    },
    "qivryn.docsIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: false });
    },
    "qivryn.docsReIndex": async () => {
      core.invoke("context/indexDocs", { reIndex: true });
    },
    "qivryn.focusQivrynInput": async () => {
      const isQivrynInputFocused = await sidebar.webviewProtocol.request(
        "isQivrynInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      const historyLength = await sidebar.webviewProtocol.request(
        "getWebviewHistoryLength",
        undefined,
        false,
      );

      if (isQivrynInputFocused) {
        if (historyLength === 0) {
          hideGUI();
        } else {
          void sidebar.webviewProtocol?.request(
            "focusQivrynInputWithNewSession",
            undefined,
            false,
          );
        }
      } else {
        focusGUI();
        sidebar.webviewProtocol?.request(
          "focusQivrynInputWithNewSession",
          undefined,
          false,
        );
        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    "qivryn.focusQivrynInputWithoutClear": async () => {
      const isQivrynInputFocused = await sidebar.webviewProtocol.request(
        "isQivrynInputFocused",
        undefined,
        false,
      );

      // This is a temporary fix—sidebar.webviewProtocol.request is blocking
      // when the GUI hasn't yet been setup and we should instead be
      // immediately throwing an error, or returning a Result object
      focusGUI();
      if (!sidebar.isReady) {
        const isReady = await waitForSidebarReady(sidebar, 5000, 100);
        if (!isReady) {
          return;
        }
      }

      if (isQivrynInputFocused) {
        hideGUI();
      } else {
        focusGUI();

        sidebar.webviewProtocol?.request(
          "focusQivrynInputWithoutClear",
          undefined,
        );

        void addHighlightedCodeToContext(sidebar.webviewProtocol);
      }
    },
    // QuickEditShowParams are passed from CodeLens, temp fix
    // until we update to new params specific to Edit
    "qivryn.focusEdit": async (args?: QuickEditShowParams) => {
      focusGUI();
      sidebar.webviewProtocol?.request("focusEdit", undefined);
    },
    "qivryn.exitEditMode": async () => {
      editDecorationManager.clear();
      void sidebar.webviewProtocol?.request("exitEditMode", undefined);
    },
    "qivryn.writeCommentsForCode": async () => {
      streamInlineEdit(
        "comment",
        "Write comments for this code. Do not change anything about the code itself.",
      );
    },
    "qivryn.writeDocstringForCode": async () => {
      void streamInlineEdit(
        "docstring",
        "Write a docstring for this code. Do not change anything about the code itself.",
      );
    },
    "qivryn.fixCode": async () => {
      streamInlineEdit(
        "fix",
        "Fix this code. If it is already 100% correct, simply rewrite the code.",
      );
    },
    "qivryn.optimizeCode": async () => {
      streamInlineEdit("optimize", "Optimize this code");
    },
    "qivryn.fixGrammar": async () => {
      streamInlineEdit(
        "fixGrammar",
        "If there are any grammar or spelling mistakes in this writing, fix them. Do not make other large changes to the writing.",
      );
    },
    "qivryn.clearConsole": async () => {
      consoleView.clearLog();
    },
    "qivryn.viewLogs": async () => {
      vscode.commands.executeCommand("workbench.action.toggleDevTools");
    },
    "qivryn.debugTerminal": async () => {
      const terminalContents = await ide.getTerminalContents();

      vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");

      sidebar.webviewProtocol?.request("userInput", {
        input: `I got the following error, can you please help explain how to fix it?\n\n${terminalContents.trim()}`,
      });
    },
    "qivryn.hideInlineTip": () => {
      vscode.workspace
        .getConfiguration(EXTENSION_NAME)
        .update("showInlineTip", false, vscode.ConfigurationTarget.Global);
    },

    // Commands without keyboard shortcuts
    "qivryn.addModel": () => {
      vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
      sidebar.webviewProtocol?.request("addModel", undefined);
    },
    "qivryn.newSession": () => {
      sidebar.webviewProtocol?.request("newSession", undefined);
    },
    "qivryn.toggleVoiceInput": async () => {
      if (!fullScreenPanel) {
        await vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
      }
      const target = fullScreenPanel?.webview ?? sidebar.webview;
      if (!target) {
        void vscode.window.showInformationMessage(
          "Open Qivryn before starting voice input.",
        );
        return;
      }
      await target.postMessage({ type: "qivryn.voice.toggle" });
    },

    "qivryn.shareSession": async (sessionId: string | undefined) => {
      if (!sessionId) {
        sessionId = await sidebar.webviewProtocol?.request(
          "getCurrentSessionId",
          undefined,
        );
      }
      if (!sessionId) {
        void vscode.window.showErrorMessage(
          "No session ID found. Please start a new session first.",
        );
        return;
      }
      //let user select the destination folder
      const destinationFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Destination Folder",
      });
      if (!destinationFolder || destinationFolder.length === 0) {
        return;
      }

      try {
        // despite core.invoke not being async, we still need to await it, because the 'history/share' command is async
        // if not awaited, then errors will not be caught.
        await core.invoke("history/share", {
          id: sessionId,
          outputDir: destinationFolder[0].fsPath,
        });
      } catch (error) {
        const errorMessage = `Failed to save session: ${error instanceof Error ? error.message : String(error)}`;
        void vscode.window.showErrorMessage(errorMessage);
      }
    },
    "qivryn.viewHistory": () => {
      vscode.commands.executeCommand("qivryn.navigateTo", "/history", true);
    },
    "qivryn.focusQivrynSessionId": async (sessionId: string | undefined) => {
      if (!sessionId) {
        sessionId = await vscode.window.showInputBox({
          prompt: "Enter the Session ID",
        });
      }
      focusFullScreenPanel(sidebar);
      void sidebar.webviewProtocol?.request("focusQivrynSessionId", {
        sessionId,
      });
    },
    "qivryn.applyCodeFromChat": () => {
      void sidebar.webviewProtocol.request("applyCodeFromChat", undefined);
    },
    "qivryn.openConfigPage": () => {
      vscode.commands.executeCommand("qivryn.navigateTo", "/config", false);
    },
    "qivryn.selectFilesAsContext": async (
      firstUri: vscode.Uri,
      uris: vscode.Uri[],
    ) => {
      if (uris === undefined) {
        throw new Error("No files were selected");
      }

      vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");

      for (const uri of uris) {
        // If it's a folder, add the entire folder contents recursively by using walkDir (to ignore ignored files)
        const isDirectory = await vscode.workspace.fs
          .stat(uri)
          ?.then((stat) => stat.type === vscode.FileType.Directory);
        if (isDirectory) {
          for await (const fileUri of walkDirAsync(uri.toString(), ide, {
            source: "vscode qivryn.selectFilesAsContext command",
          })) {
            await addEntireFileToContext(
              vscode.Uri.parse(fileUri),
              sidebar.webviewProtocol,
              ide.ideUtils,
            );
          }
        } else {
          await addEntireFileToContext(
            uri,
            sidebar.webviewProtocol,
            ide.ideUtils,
          );
        }
      }
    },
    "qivryn.logAutocompleteOutcome": (
      completionId: string,
      completionProvider: CompletionProvider,
    ) => {
      completionProvider.accept(completionId);
    },
    "qivryn.logNextEditOutcomeAccept": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.accept(completionId);
    },
    "qivryn.logNextEditOutcomeReject": (
      completionId: string,
      nextEditLoggingService: NextEditLoggingService,
    ) => {
      nextEditLoggingService.reject(completionId);
    },
    "qivryn.toggleTabAutocompleteEnabled": () => {
      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const enabled = config.get("enableTabAutocomplete");
      const pauseOnBattery = config.get<boolean>(
        "pauseTabAutocompleteOnBattery",
      );
      if (!pauseOnBattery || battery.isACConnected()) {
        config.update(
          "enableTabAutocomplete",
          !enabled,
          vscode.ConfigurationTarget.Global,
        );
      } else {
        if (enabled) {
          const paused = getStatusBarStatus() === StatusBarStatus.Paused;
          if (paused) {
            setupStatusBar(StatusBarStatus.Enabled);
          } else {
            config.update(
              "enableTabAutocomplete",
              false,
              vscode.ConfigurationTarget.Global,
            );
          }
        } else {
          setupStatusBar(StatusBarStatus.Paused);
          config.update(
            "enableTabAutocomplete",
            true,
            vscode.ConfigurationTarget.Global,
          );
        }
      }
    },
    "qivryn.forceAutocomplete": async () => {
      // 1. Explicitly hide any existing suggestion. This clears VS Code's cache for the current position.
      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      // 2. Now trigger a new one. VS Code has no cached suggestion, so it's forced to call our provider.
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },

    "qivryn.openTabAutocompleteConfigMenu": async () => {
      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const quickPick = vscode.window.createQuickPick();

      const { config: qivrynConfig } = await configHandler.loadConfig();
      const autocompleteModels = qivrynConfig?.modelsByRole.autocomplete ?? [];
      const selected =
        qivrynConfig?.selectedModelByRole?.autocomplete?.title ?? undefined;

      // Toggle between Disabled, Paused, and Enabled
      const pauseOnBattery =
        config.get<boolean>("pauseTabAutocompleteOnBattery") &&
        !battery.isACConnected();
      const currentStatus = getStatusBarStatus();

      let targetStatus: StatusBarStatus | undefined;
      if (pauseOnBattery) {
        // Cycle from Disabled -> Paused -> Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Paused
            ? StatusBarStatus.Enabled
            : currentStatus === StatusBarStatus.Disabled
              ? StatusBarStatus.Paused
              : StatusBarStatus.Disabled;
      } else {
        // Toggle between Disabled and Enabled
        targetStatus =
          currentStatus === StatusBarStatus.Disabled
            ? StatusBarStatus.Enabled
            : StatusBarStatus.Disabled;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      quickPick.items = [
        {
          label: "$(gear) Open settings",
        },
        {
          label: "$(comment) Open chat",
          description: getMetaKeyLabel() + " + L",
        },
        {
          label: "$(screen-full) Open full screen chat",
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + M",
        },
        {
          label: quickPickStatusText(targetStatus),
          description:
            getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + A",
        },
        ...getNextEditMenuItems(currentStatus, nextEditEnabled),
        {
          kind: vscode.QuickPickItemKind.Separator,
          label: "Switch model",
        },
        ...autocompleteModels.map((model) => ({
          label: getAutocompleteStatusBarTitle(selected, model),
          description: getAutocompleteStatusBarDescription(selected, model),
        })),
      ];
      quickPick.onDidAccept(() => {
        const selectedOption = quickPick.selectedItems[0].label;
        const targetStatus =
          getStatusBarStatusFromQuickPickItemLabel(selectedOption);

        if (targetStatus !== undefined) {
          setupStatusBar(targetStatus);
          config.update(
            "enableTabAutocomplete",
            targetStatus === StatusBarStatus.Enabled,
            vscode.ConfigurationTarget.Global,
          );
        } else if (isNextEditToggleLabel(selectedOption)) {
          handleNextEditToggle(selectedOption, config);
        } else if (
          autocompleteModels.some((model) => model.title === selectedOption)
        ) {
          if (core.configHandler.currentProfile?.profileDescription.id) {
            core.invoke("config/updateSelectedModel", {
              profileId:
                core.configHandler.currentProfile?.profileDescription.id,
              role: "autocomplete",
              title: selectedOption,
            });
          }
        } else if (selectedOption === "$(comment) Open chat") {
          vscode.commands.executeCommand("qivryn.focusQivrynInput");
        } else if (selectedOption === "$(screen-full) Open full screen chat") {
          vscode.commands.executeCommand("qivryn.openInNewWindow", "/");
        } else if (selectedOption === "$(gear) Open settings") {
          vscode.commands.executeCommand("qivryn.navigateTo", "/config");
        }

        quickPick.dispose();
      });
      quickPick.show();
    },
    "qivryn.navigateTo": (path: string, toggle: boolean) => {
      focusFullScreenPanel(sidebar);
      sidebar.webviewProtocol?.request("navigateTo", {
        path: normalizeQivrynWebviewRoute(path) ?? CHAT_ROUTE,
        toggle,
      });
      focusGUI();
    },
    "qivryn.openAgentsWindow": async (resource?: vscode.Uri) => {
      const agentsRoute = toAgentsWebviewRoute(resource);
      if (fullScreenPanel) {
        // The standalone panel is already the intended destination. Rebuild it
        // with the Agents route in place; opening the command again used to
        // merely reveal the existing chat route.
        return vscode.commands.executeCommand(
          "qivryn.reloadAgentsWindow",
          agentsRoute,
        );
      }
      return vscode.commands.executeCommand(
        "qivryn.openInNewWindow",
        agentsRoute,
        false,
        false,
      );
    },
    "qivryn.reloadAgentsWindow": async (initialPath?: string) => {
      const reloadPath = normalizeQivrynWebviewRoute(initialPath) ?? CHAT_ROUTE;
      if (!fullScreenPanel) {
        sidebar.reload(reloadPath);
        return;
      }
      // Do not rebuild the panel here: a retained webview can restore its
      // previous chat state and ignore the new initial route. Route the live
      // fullscreen SPA directly, as the other standalone menu actions do.
      focusFullScreenPanel(sidebar);
      await sidebar.webviewProtocol.request("navigateTo", {
        path: reloadPath,
        toggle: false,
      });
    },
    "qivryn.closeAgentsWindow": () => {
      fullScreenPanel?.dispose();
    },
    "qivryn.openAgentReview": (reportId?: string) =>
      vscode.commands.executeCommand(
        "qivryn.navigateTo",
        reportId
          ? `/review?reviewId=${encodeURIComponent(reportId)}`
          : "/review",
        false,
      ),
    "qivryn.acceptReviewFinding": () => nativeReview.accept(),
    "qivryn.rejectReviewFinding": () => nativeReview.reject(),
    "qivryn.commentReviewFinding": () => nativeReview.comment(),
    "qivryn.restoreReviewCheckpoint": () => nativeReview.restoreCheckpoint(),
    "qivryn.rerunAgentReview": () => nativeReview.rerun(),
    "qivryn.openTerminalAssistant": () => nativeTerminalJobs.open(),
    "qivryn.stopTerminalJob": () => nativeTerminalJobs.stop(),
    "qivryn.openTerminalPromptBar": async () => {
      const command = await vscode.window.showInputBox({
        title: "Qivryn Terminal Prompt",
        prompt: "Generate, inspect, or run a shell command",
        placeHolder: "Enter a shell command",
        ignoreFocusOut: true,
      });
      if (!command?.trim()) return;
      const classification = classifyTerminalCommand(
        "allowedWithoutPermission",
        command,
        { sandboxed: false },
      );
      const risky =
        classification.elevated ||
        classification.requiresNetwork ||
        classification.mutatesFilesystem ||
        classification.policy === "allowedWithPermission";
      if (classification.policy === "disabled") {
        void vscode.window.showErrorMessage(
          `Qivryn blocked this command: ${classification.reasons.join("; ")}`,
        );
        return;
      }
      if (risky) {
        const decision = await vscode.window.showWarningMessage(
          `${classification.elevated ? "Elevated · " : ""}${classification.requiresNetwork ? "Network · " : ""}${classification.reasons.join("; ")}`,
          { modal: true, detail: command },
          "Run",
          "Open Terminal Assistant",
        );
        if (decision === "Open Terminal Assistant") {
          return vscode.commands.executeCommand("qivryn.openTerminalAssistant");
        }
        if (decision !== "Run") return;
      }
      const terminal =
        vscode.window.activeTerminal ??
        vscode.window.createTerminal({ name: "Qivryn Agent" });
      terminal.show();
      terminal.sendText(command, true);
    },
    "qivryn.openBrowserWorkspace": (url?: string) => nativeBrowser.open(url),
    "qivryn.browserBack": () => nativeBrowser.back(),
    "qivryn.browserForward": () => nativeBrowser.forward(),
    "qivryn.browserReload": () => nativeBrowser.reload(),
    "qivryn.browserTakeover": () => nativeBrowser.takeover(),
    "qivryn.browserScreenshot": () => nativeBrowser.screenshot(),
    "qivryn.openAgentAttribution": openAgentAttribution,
    "qivryn.chooseLayout": () => layoutManager.chooseAndApply(),
    "qivryn.saveLayout": () => layoutManager.saveCurrent(),
    "qivryn.openAgentGraph": () => agentScmGraphManager.openGraph(),
    "qivryn.acceptNextSuggestionToken": () =>
      vscode.commands.executeCommand(partialSuggestionCommand("token")),
    "qivryn.acceptNextSuggestionWord": () =>
      vscode.commands.executeCommand(partialSuggestionCommand("word")),
    "qivryn.acceptNextSuggestionLine": () =>
      vscode.commands.executeCommand(partialSuggestionCommand("line")),
    "qivryn.generateCommitMessage": async () => {
      const staged = await ide.getDiff(false);
      const changes = staged.length > 0 ? staged : await ide.getDiff(true);
      if (changes.length === 0) {
        void vscode.window.showInformationMessage("No Git changes found.");
        return;
      }
      const { config } = await configHandler.loadConfig();
      const llm = config?.selectedModelByRole.chat;
      const message = await generateCommitMessage(
        changes.join("\n"),
        llm
          ? (prompt) => llm.complete(prompt, new AbortController().signal)
          : undefined,
      );
      const git = vscode.extensions
        .getExtension("vscode.git")
        ?.exports?.getAPI?.(1);
      const repository =
        git?.repositories?.find((candidate: any) => {
          const folder = vscode.workspace.getWorkspaceFolder(candidate.rootUri);
          return Boolean(folder);
        }) ?? git?.repositories?.[0];
      if (!repository?.inputBox) {
        await vscode.env.clipboard.writeText(message);
        void vscode.window.showInformationMessage(
          "Commit message copied to the clipboard.",
        );
        return;
      }
      repository.inputBox.value = message;
      await vscode.commands.executeCommand("workbench.view.scm");
    },
    "qivryn.openSlackConnector": () =>
      vscode.commands.executeCommand(
        "qivryn.navigateTo",
        "/connectors/slack",
        false,
      ),
    "qivryn.exportAgentDiagnostics": async () => {
      const store = new FileAgentStore(
        path.join(getQivrynGlobalPath(), "agents"),
      );
      const report = await createAgentDiagnosticReport(store);
      const destination = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(
            os.homedir(),
            `qivryn-agent-diagnostics-${Date.now()}.json`,
          ),
        ),
        filters: { JSON: ["json"] },
        saveLabel: "Export redacted diagnostics",
        title: "Export Qivryn Agent Diagnostics",
      });
      if (!destination) return;
      await vscode.workspace.fs.writeFile(
        destination,
        Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
      );
      void vscode.window.showInformationMessage(
        "Exported redacted agent diagnostics. Nothing was uploaded.",
      );
    },
    "qivryn.switchAgent": async () => {
      const store = new FileAgentStore(
        path.join(getQivrynGlobalPath(), "agents"),
      );
      await store.initialize();
      const runs = await store.listRuns({ limit: 100 });
      const selected = await vscode.window.showQuickPick(
        runs.map((run) => ({
          label: run.title,
          description: `${run.status} · ${run.workspace.branch ?? run.workspace.location}`,
          detail: run.workspace.worktreePath ?? run.workspace.repositoryPath,
          runId: run.id,
        })),
        {
          title: "Switch Agent",
          placeHolder: "Search recent agents",
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (selected) {
        await vscode.commands.executeCommand(
          "qivryn.navigateTo",
          CHAT_ROUTE,
          false,
        );
      }
    },
    "qivryn.startLocalOllama": () => {
      startLocalOllama(ide);
    },
    "qivryn.startLocalLemonade": () => {
      startLocalLemonade(ide);
    },
    "qivryn.installModel": async (
      modelName: string,
      llmProvider: ILLM | undefined,
    ) => {
      try {
        if (!isModelInstaller(llmProvider)) {
          const msg = llmProvider
            ? `LLM provider '${llmProvider.providerName}' does not support installing models`
            : "Missing LLM Provider";
          throw new Error(msg);
        }
        await installModelWithProgress(modelName, llmProvider);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(
          `Failed to install '${modelName}': ${message}`,
        );
      }
    },
    "qivryn.convertConfigJsonToConfigYaml": async () => {
      const configJson = fs.readFileSync(getConfigJsonPath(), "utf-8");
      const parsed = JSON.parse(configJson);
      const configYaml = convertJsonToYamlConfig(parsed);

      const configYamlPath = getConfigYamlPath();
      fs.writeFileSync(configYamlPath, YAML.stringify(configYaml));
      setConfigFilePermissions(configYamlPath);

      // Open config.yaml
      await openEditorAndRevealRange(
        vscode.Uri.file(configYamlPath),
        undefined,
        undefined,
        false,
      );

      void vscode.window
        .showInformationMessage(
          "Your config.json has been converted to the new config.yaml format. If you need to switch back to config.json, you can delete or rename config.yaml.",
          "Read the docs",
        )
        .then(async (selection) => {
          if (selection === "Read the docs") {
            await vscode.env.openExternal(
              vscode.Uri.parse("https://docs.qivryn.ai/yaml-migration"),
            );
          }
        });
    },
    "qivryn.enterEnterpriseLicenseKey": async () => {
      const licenseKey = await vscode.window.showInputBox({
        prompt: "Enter your enterprise license key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "License key",
      });

      if (!licenseKey) {
        return;
      }

      try {
        const isValid = core.invoke("mdm/setLicenseKey", {
          licenseKey,
        });

        if (isValid) {
          void vscode.window.showInformationMessage(
            "Enterprise license key successfully validated and saved. Reloading window.",
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          void vscode.window.showErrorMessage(
            "Invalid license key. Please check your license key and try again.",
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Failed to set enterprise license key: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    "qivryn.toggleNextEditEnabled": async () => {
      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const tabAutocompleteEnabled = config.get<boolean>(
        "enableTabAutocomplete",
      );

      if (!tabAutocompleteEnabled) {
        vscode.window.showInformationMessage(
          "Please enable tab autocomplete first to use Next Edit",
        );
        return;
      }

      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;

      // updateNextEditState in VsCodeExtension.ts will handle the validation.
      config.update(
        "enableNextEdit",
        !nextEditEnabled,
        vscode.ConfigurationTarget.Global,
      );
    },
    "qivryn.openSessionFromAgents": async (sessionId: string) => {
      if (focusFullScreenPanel(sidebar)) {
        // History and session menus are rendered by the fullscreen webview
        // itself. Disposing it here hands control back to the sidebar and
        // makes the dedicated chat appear to minimize. Keep the existing
        // panel alive and load the selected session in place instead.
        await sidebar.webviewProtocol.request("navigateTo", {
          path: CHAT_ROUTE,
          toggle: false,
        });
        await sidebar.webviewProtocol.request("focusQivrynSessionId", {
          sessionId,
        });
        return;
      }
      fullScreenRecoverySessionId = sessionId;
      await vscode.commands.executeCommand("qivryn.qivrynGUIView.focus");
      await vscode.commands.executeCommand(
        "qivryn.navigateTo",
        CHAT_ROUTE,
        false,
      );
    },
    "qivryn.openInNewWindow": async (
      initialPath?: string,
      moveToNewWindow = false,
      resetSidebar = true,
    ) => {
      initialPath = normalizeQivrynWebviewRoute(initialPath) ?? CHAT_ROUTE;
      if (moveToNewWindow) {
        focusGUI();
      }

      let sessionId: string | undefined;
      if (sidebar.isReady) {
        try {
          sessionId = await sidebar.webviewProtocol.request(
            "getCurrentSessionId",
            undefined,
          );
        } catch {
          sessionId = undefined;
        }
      }
      fullScreenRecoverySessionId = sessionId;
      // Check if full screen is already open by checking open tabs
      const fullScreenTab = getFullScreenTab();

      if (fullScreenTab && fullScreenPanel) {
        // A full-screen action from any Qivryn menu should never collapse the
        // active panel. It is already the destination, so just make it active.
        focusFullScreenPanel(sidebar);
        return;
      }

      if (fullScreenTab) {
        // VS Code can restore a serialized Qivryn panel before the extension
        // host receives its panel reference. Do not create a duplicate panel
        // during startup; the restored editor is already the fullscreen
        // workspace the user expects.
        return;
      }

      // Clear the sidebar before full-screen chat/browser sessions to prevent
      // overwriting changes made in fullscreen.
      if (resetSidebar && sidebar.isReady) {
        vscode.commands.executeCommand("qivryn.newSession");
      }

      // Full screen not open - open it
      // Create the full screen panel
      let panel = vscode.window.createWebviewPanel(
        "qivryn.qivrynGUIView",
        initialPath === "/browser" ? "Qivryn Browser" : "Qivryn",
        vscode.ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
        },
      );
      fullScreenPanel = panel;

      // The fullscreen panel is the sole Qivryn surface while it is open.
      // Close the normal sidebar immediately instead of waiting for the
      // webview boot handshake, which previously left both side by side.
      void vscode.commands.executeCommand("workbench.action.closeSidebar");

      const webviewBooted = waitForWebviewBoot(panel.webview, 5_000);

      // Add content to the panel
      panel.webview.html = sidebar.getSidebarContent(
        extensionContext,
        panel,
        initialPath,
        undefined,
        true,
      );

      await webviewBooted;
      if (sessionId) {
        await sidebar.webviewProtocol.request("focusQivrynSessionId", {
          sessionId,
        });
      }

      // When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          fullScreenRecoverySessionId = undefined;
          if (fullScreenPanel === panel) fullScreenPanel = undefined;
          sidebar.resetWebviewProtocolWebview();
        },
        null,
        extensionContext.subscriptions,
      );

      // Moving preserves the original WebviewPanel and its message channel.
      // Copying creates a second visual webview whose buttons are no longer
      // connected to `fullScreenPanel`, which is why the Agents window could
      // render normally while every click appeared to hang.
      if (moveToNewWindow) {
        panel.reveal(vscode.ViewColumn.One, true);
        await vscode.commands.executeCommand(
          "workbench.action.closeAuxiliaryBar",
        );
        await vscode.commands.executeCommand(
          "workbench.action.moveEditorToNewWindow",
        );
      } else {
        panel.reveal(vscode.ViewColumn.One);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await vscode.commands.executeCommand(
          "workbench.action.closeAuxiliaryBar",
        );
      }
    },
    "qivryn.forceNextEdit": async () => {
      // This is basically the same logic as forceAutocomplete.
      // I'm writing a new command KV pair here in case we diverge in features.

      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");

      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    },
  };
};

async function installModelWithProgress(
  modelName: string,
  modelInstaller: ModelInstaller,
) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Installing model '${modelName}'`,
      cancellable: true,
    },
    async (windowProgress, token) => {
      let currentProgress: number = 0;
      const progressWrapper = (
        details: string,
        worked?: number,
        total?: number,
      ) => {
        let increment = 0;
        if (worked && total) {
          const progressValue = Math.round((worked / total) * 100);
          increment = progressValue - currentProgress;
          currentProgress = progressValue;
        }
        windowProgress.report({ message: details, increment });
      };
      const abortController = new AbortController();
      token.onCancellationRequested(() => {
        console.log(`Pulling ${modelName} model was cancelled`);
        abortController.abort();
      });
      await modelInstaller.installModel(
        modelName,
        abortController.signal,
        progressWrapper,
      );
    },
  );
}

export function registerAllCommands(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
  extensionContext: vscode.ExtensionContext,
  sidebar: QivrynGUIWebviewViewProvider,
  consoleView: QivrynConsoleWebviewViewProvider,
  configHandler: ConfigHandler,
  verticalDiffManager: VerticalDiffManager,
  battery: Battery,
  quickEdit: QuickEdit,
  core: Core,
  editDecorationManager: EditDecorationManager,
  layoutManager: QivrynLayoutManager,
  agentScmGraphManager: AgentScmGraphManager,
) {
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("qivryn.qivrynGUIView", {
      async deserializeWebviewPanel(panel, state) {
        if (
          vscode.env.appName.startsWith("Qivryn") &&
          process.env.QIVRYN_RESTORE_DEDICATED_CHAT_WINDOWS !== "true"
        ) {
          panel.dispose();
          if (fullScreenPanel === panel) fullScreenPanel = undefined;
          return;
        }

        fullScreenPanel = panel;
        const restoredState = state as { page?: unknown } | undefined;
        const restoredPath = normalizeQivrynWebviewRoute(
          typeof restoredState?.page === "string"
            ? restoredState.page
            : undefined,
        );
        panel.title = restoredPath === "/browser" ? "Qivryn Browser" : "Qivryn";
        panel.webview.html = sidebar.getSidebarContent(
          extensionContext,
          panel,
          restoredPath ?? CHAT_ROUTE,
          undefined,
          true,
        );
        panel.onDidDispose(
          () => {
            fullScreenRecoverySessionId = undefined;
            if (fullScreenPanel === panel) fullScreenPanel = undefined;
            sidebar.resetWebviewProtocolWebview();
          },
          null,
          context.subscriptions,
        );
      },
    }),
  );

  for (const [command, callback] of Object.entries(
    getCommandsMap(
      ide,
      extensionContext,
      sidebar,
      consoleView,
      configHandler,
      verticalDiffManager,
      battery,
      quickEdit,
      core,
      editDecorationManager,
      layoutManager,
      agentScmGraphManager,
    ),
  )) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
  }
}
