import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { MainEditorProvider } from "../../components/mainInput/TipTapEditor";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { setupStore } from "../../redux/store";
import "../../index.css";
import ConfigPage from ".";

const messenger = new MockIdeMessenger();
messenger.responses["extensions/plugins"] = [
  {
    id: "computer-use",
    name: "computer-use",
    displayName: "Computer Use",
    version: "1.0.0",
    description: "Desktop interaction and screenshot tools for local agents.",
    developerName: "OpenAI",
    enabled: true,
    sourcePath: "/Users/user/.qivryn/plugins/computer-use",
    installedPath: "/Users/user/.qivryn/plugins/installed/computer-use",
    installedAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    contributions: { skills: 1, rules: 0, agents: 0, mcp: 1 },
  },
  {
    id: "release-tools",
    name: "release-tools",
    displayName: "Release Tools",
    version: "2.4.1",
    description: "Build, package, and release validation workflows.",
    developerName: "Qivryn",
    enabled: true,
    sourcePath: "/Users/user/qivryn/.qivryn/plugins/release-tools",
    installedPath: "/Users/user/.qivryn/plugins/installed/release-tools",
    installedAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    contributions: { skills: 3, rules: 1, agents: 1, mcp: 0 },
  },
];
messenger.responses["extensions/skills"] = {
  skills: [
    {
      name: "ui-ux-pro-max",
      description: "Review responsive UI quality and design-system usage.",
      content: "# UI review",
      path: ".agents/skills/ui-ux-pro-max/SKILL.md",
      sourceFile: "file:///workspace/.agents/skills/ui-ux-pro-max/SKILL.md",
      provenance: "Workspace",
      scope: "workspace",
      readOnly: false,
      files: [],
    },
    {
      name: "github-release-build",
      description: "Build, package, publish, and verify Qivryn releases.",
      content: "# Release build",
      path: ".agents/skills/github-release-build/SKILL.md",
      sourceFile:
        "file:///workspace/.agents/skills/github-release-build/SKILL.md",
      provenance: "Workspace",
      scope: "workspace",
      readOnly: false,
      files: [],
    },
  ],
  errors: [],
};
messenger.responses["extensions/codexImportPreview"] = {
  version: 1,
  sourceRoot: "/Users/user/.codex",
  scannedAt: "2026-07-12T05:40:00.000Z",
  counts: {
    mcp: 16,
    plugin: 16,
    skill: 232,
    hook: 6,
    rule: 4,
    agent: 12,
    automation: 2,
  },
  issues: [
    "Codex command prefix rules remain read-only in Codex because translating them would broaden Qivryn terminal permissions.",
  ],
  items: [
    {
      id: "playwright",
      name: "playwright",
      kind: "mcp",
      enabled: true,
      sourceEnabled: true,
      reviewed: true,
      canToggle: true,
      detail: "stdio",
      state: "imported",
    },
    {
      id: "computer-use",
      name: "computer-use",
      kind: "plugin",
      enabled: true,
      sourceEnabled: true,
      reviewed: true,
      canToggle: true,
      detail: "v1.0.1000366",
      state: "imported",
    },
    {
      id: "ui-ux-pro-max",
      name: "ui-ux-pro-max",
      kind: "skill",
      enabled: true,
      sourceEnabled: true,
      reviewed: true,
      canToggle: true,
      detail: "Codex skill",
      state: "linked",
    },
    {
      id: "UserPromptSubmit:0:0",
      name: "evidence_first_guard.py",
      kind: "hook",
      enabled: false,
      sourceEnabled: true,
      reviewed: false,
      canToggle: true,
      detail:
        "UserPromptSubmit · python3 /Users/user/.codex/hooks/evidence_first_guard.py",
      state: "needs-review",
    },
    {
      id: "global-agents",
      name: "Global AGENTS.md",
      kind: "rule",
      enabled: true,
      sourceEnabled: true,
      reviewed: true,
      canToggle: true,
      detail: "Global instructions",
      state: "linked",
    },
    {
      id: "reviewer",
      name: "reviewer",
      kind: "agent",
      enabled: true,
      sourceEnabled: true,
      reviewed: true,
      canToggle: true,
      detail: "Portable subagent definition",
      state: "linked",
    },
    {
      id: "daily-review",
      name: "Daily review",
      kind: "automation",
      enabled: false,
      sourceEnabled: false,
      reviewed: true,
      canToggle: true,
      detail: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      state: "imported",
    },
  ],
};

const store = setupStore({ ideMessenger: messenger });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={["/config?tab=extensions"]}>
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <ConfigPage />
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
