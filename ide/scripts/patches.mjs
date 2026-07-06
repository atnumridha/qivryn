import fs from "node:fs";
import path from "node:path";

import {
  applyNativeWorktreeTabs,
  targetFile as nativeWorktreeTabsTarget,
} from "../patches/native-worktree-tabs.mjs";
import {
  applyOptionalChatOnboarding,
  targetFile as optionalChatOnboardingTarget,
} from "../patches/optional-chat-onboarding.mjs";
import {
  applyOptionalDefaultAccount,
  targetFile as optionalDefaultAccountTarget,
} from "../patches/optional-default-account.mjs";
import {
  applyOptionalBuiltInCopilot,
  targetFile as optionalBuiltInCopilotTarget,
} from "../patches/optional-built-in-copilot.mjs";
import {
  applyContextKeyCommand,
  targetFile as contextKeyCommandTarget,
} from "../patches/context-key-command.mjs";
import {
  applyOptionalDefaultChatAgent,
  targetFile as optionalDefaultChatAgentTarget,
} from "../patches/optional-default-chat-agent.mjs";
import {
  applyQivrynDefaultAgentSession,
  targetFile as qivrynDefaultAgentSessionTarget,
} from "../patches/qivryn-default-agent-session.mjs";
import {
  applyQivrynAgentsContainer,
  applyQivrynSessionPaneOpener,
  containerTarget as qivrynAgentsContainerTarget,
  openerTarget as qivrynSessionOpenerTarget,
} from "../patches/qivryn-native-agent-workspace.mjs";
import {
  applyQivrynLayoutDimensions,
  applyQivrynSidebarMinimum,
  layoutTarget as qivrynLayoutDimensionsTarget,
  sidebarPartTarget as qivrynSidebarMinimumTarget,
} from "../patches/qivryn-sidebar-dimensions.mjs";
import {
  applyQivrynCliLauncher,
  targetFile as qivrynCliLauncherTarget,
} from "../patches/qivryn-cli-launcher.mjs";
import {
  applyQivrynStartupEditor,
  targetFile as qivrynStartupEditorTarget,
} from "../patches/qivryn-startup-editor.mjs";
import {
  applyQivrynWebviewFileDrop,
  targetFile as qivrynWebviewFileDropTarget,
} from "../patches/qivryn-webview-file-drop.mjs";
import {
  applyNativeAgentChatCss,
  applyNativeAgentInitialScroll,
  applyNativeAgentSessionsCss,
  applyNativeAgentSessionsViewer,
  applyNativeSessionHeaderRenderer,
  applyNativeSessionHeaderTransport,
  chatCssTarget as nativeAgentChatCssTarget,
  chatListRendererTarget as nativeAgentChatListRendererTarget,
  chatWidgetTarget as nativeAgentChatWidgetTarget,
  sessionTransportTarget as nativeAgentSessionTransportTarget,
  viewerCssTarget as nativeAgentSessionsCssTarget,
  viewerTarget as nativeAgentSessionsViewerTarget,
} from "../patches/native-agent-sessions.mjs";
import {
  applyNativeAgentSessionState,
  targetFile as nativeAgentSessionStateTarget,
} from "../patches/native-agent-session-state.mjs";
import {
  applyQivrynAgentWindowHandoff,
  targetFile as qivrynAgentWindowHandoffTarget,
} from "../patches/qivryn-agent-window-handoff.mjs";
import {
  applyQivrynActiveAgentSelection,
  applyQivrynAgentEditorTitle,
  applyQivrynAgentsSearch,
  applyQivrynAgentsSearchFilter,
  applyQivrynAgentsSidebarVisibility,
  applyQivrynAgentsViewPane,
  applyQivrynAgentsViewPaneCss,
  editorInputTarget as qivrynAgentEditorTitleTarget,
  sessionsControlTarget as qivrynActiveAgentSelectionTarget,
  sessionsFilterTarget as qivrynAgentsSearchFilterTarget,
  viewPaneCssTarget as qivrynAgentsViewPaneCssTarget,
  viewPaneTarget as qivrynAgentsViewPaneTarget,
} from "../patches/qivryn-native-agent-workspace.mjs";

const patches = [
  {
    id: "qivryn-startup-editor",
    targetFile: qivrynStartupEditorTarget,
    apply: applyQivrynStartupEditor,
  },
  {
    id: "qivryn-cli-launcher",
    targetFile: qivrynCliLauncherTarget,
    apply: applyQivrynCliLauncher,
  },
  {
    id: "qivryn-webview-file-drop",
    targetFile: qivrynWebviewFileDropTarget,
    apply: applyQivrynWebviewFileDrop,
  },
  {
    id: "optional-built-in-copilot",
    targetFile: optionalBuiltInCopilotTarget,
    apply: applyOptionalBuiltInCopilot,
  },
  {
    id: "optional-default-chat-agent",
    targetFile: optionalDefaultChatAgentTarget,
    apply: applyOptionalDefaultChatAgent,
  },
  {
    id: "qivryn-default-agent-session",
    targetFile: qivrynDefaultAgentSessionTarget,
    apply: applyQivrynDefaultAgentSession,
  },
  {
    id: "qivryn-native-agent-container",
    targetFile: qivrynAgentsContainerTarget,
    apply: applyQivrynAgentsContainer,
  },
  {
    id: "qivryn-session-pane-opener",
    targetFile: qivrynSessionOpenerTarget,
    apply: applyQivrynSessionPaneOpener,
  },
  {
    id: "native-agent-sessions-css",
    targetFile: nativeAgentSessionsCssTarget,
    apply: applyNativeAgentSessionsCss,
  },
  {
    id: "native-agent-sessions-viewer",
    targetFile: nativeAgentSessionsViewerTarget,
    apply: applyNativeAgentSessionsViewer,
  },
  {
    id: "native-agent-chat-css",
    targetFile: nativeAgentChatCssTarget,
    apply: applyNativeAgentChatCss,
  },
  {
    id: "native-agent-session-transport",
    targetFile: nativeAgentSessionTransportTarget,
    apply: applyNativeSessionHeaderTransport,
  },
  {
    id: "native-agent-session-renderer",
    targetFile: nativeAgentChatListRendererTarget,
    apply: applyNativeSessionHeaderRenderer,
  },
  {
    id: "native-agent-session-scroll",
    targetFile: nativeAgentChatWidgetTarget,
    apply: applyNativeAgentInitialScroll,
  },
  {
    id: "native-agent-session-state",
    targetFile: nativeAgentSessionStateTarget,
    apply: applyNativeAgentSessionState,
  },
  {
    id: "qivryn-agent-window-handoff",
    targetFile: qivrynAgentWindowHandoffTarget,
    apply: applyQivrynAgentWindowHandoff,
  },
  {
    id: "qivryn-agents-view-pane",
    targetFile: qivrynAgentsViewPaneTarget,
    apply: applyQivrynAgentsViewPane,
  },
  {
    id: "qivryn-agents-search",
    targetFile: qivrynAgentsViewPaneTarget,
    apply: applyQivrynAgentsSearch,
  },
  {
    id: "qivryn-agents-sidebar-visibility",
    targetFile: qivrynAgentsViewPaneTarget,
    apply: applyQivrynAgentsSidebarVisibility,
  },
  {
    id: "qivryn-agents-view-pane-css",
    targetFile: qivrynAgentsViewPaneCssTarget,
    apply: applyQivrynAgentsViewPaneCss,
  },
  {
    id: "qivryn-agents-search-filter",
    targetFile: qivrynAgentsSearchFilterTarget,
    apply: applyQivrynAgentsSearchFilter,
  },
  {
    id: "qivryn-active-agent-selection",
    targetFile: qivrynActiveAgentSelectionTarget,
    apply: applyQivrynActiveAgentSelection,
  },
  {
    id: "qivryn-agent-editor-title",
    targetFile: qivrynAgentEditorTitleTarget,
    apply: applyQivrynAgentEditorTitle,
  },
  {
    id: "qivryn-layout-dimensions",
    targetFile: qivrynLayoutDimensionsTarget,
    apply: applyQivrynLayoutDimensions,
  },
  {
    id: "qivryn-sidebar-minimum",
    targetFile: qivrynSidebarMinimumTarget,
    apply: applyQivrynSidebarMinimum,
  },
  {
    id: "native-worktree-tabs",
    targetFile: nativeWorktreeTabsTarget,
    apply: applyNativeWorktreeTabs,
  },
  {
    id: "optional-chat-onboarding",
    targetFile: optionalChatOnboardingTarget,
    apply: applyOptionalChatOnboarding,
  },
  {
    id: "optional-default-account",
    targetFile: optionalDefaultAccountTarget,
    apply: applyOptionalDefaultAccount,
  },
  {
    id: "context-key-command",
    targetFile: contextKeyCommandTarget,
    apply: applyContextKeyCommand,
  },
];

export function applyCodeOssPatches(vscodeDirectory) {
  for (const patch of patches) {
    const filepath = path.join(vscodeDirectory, patch.targetFile);
    const source = fs.readFileSync(filepath, "utf8");
    const transformed = patch.apply(source);
    if (transformed !== source) fs.writeFileSync(filepath, transformed);
  }
}

export function assertCodeOssPatches(vscodeDirectory) {
  for (const patch of patches) {
    const filepath = path.join(vscodeDirectory, patch.targetFile);
    const source = fs.readFileSync(filepath, "utf8");
    if (patch.apply(source) !== source) {
      throw new Error(`Code - OSS patch ${patch.id} is not applied`);
    }
  }
}
