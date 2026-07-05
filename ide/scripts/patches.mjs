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
