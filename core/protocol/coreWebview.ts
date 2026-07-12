import type {
  AgentAutomation,
  AgentAutomationControlRequest,
  AgentCheckpoint,
  AgentControlRequest,
  AgentControlResult,
  AgentEvent,
  AgentQueueItem,
  AgentPlan,
  AgentRun,
  AgentRuntimeStatus,
  AgentRunSnapshot,
  AgentWorkspace,
  ListAgentRunsOptions,
  ReadAgentEventsOptions,
} from "@qivryn/agent-runtime";
import type {
  CreateReviewRequest,
  ReviewActionRequest,
  ReviewActionResult,
  ReviewFindingComment,
  ReviewReport,
} from "@qivryn/review-engine";
import type {
  TerminalCommandClassification,
  TerminalJob,
  ToolPolicy,
} from "@qivryn/terminal-security";
import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserPermissionGrant,
  CreateBrowserSessionRequest,
} from "@qivryn/browser-runtime";
import type { BrowserEvent, BrowserSession } from "@qivryn/agent-runtime";
import type {
  SlackAuthorization,
  SlackChannel,
  SlackMessage,
} from "@qivryn/slack-connector";
import { ToCoreFromIdeOrWebviewProtocol } from "./core.js";
import { ToWebviewFromIdeOrCoreProtocol } from "./webview.js";
import type {
  ApplyCodexImportRequest,
  ApplyCodexImportResult,
  CodexImportInventory,
  SetCodexImportItemEnabledRequest,
} from "../config/codex/codexImportManager";

export interface InstalledLocalPlugin {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  developerName?: string;
  enabled: boolean;
  sourcePath: string;
  installedPath: string;
  installedAt: string;
  updatedAt: string;
  sourceKind?: "local" | "codex";
  installMode?: "copied" | "linked";
  contributions: {
    skills: number;
    rules: number;
    agents: number;
    mcp: number;
  };
}

export type ToCoreFromWebviewProtocol = ToCoreFromIdeOrWebviewProtocol & {
  didChangeSelectedProfile: [{ id: string }, void];
  "agents/list": [ListAgentRunsOptions | undefined, AgentRun[]];
  "agents/events": [
    { runId: string; options?: ReadAgentEventsOptions },
    AgentEvent[],
  ];
  "agents/stream": [
    { runId: string; options?: ReadAgentEventsOptions },
    AsyncGenerator<AgentEvent, void>,
  ];
  "agents/status": [undefined, AgentRuntimeStatus];
  "agents/control": [AgentControlRequest, AgentControlResult];
  "agents/queue": [{ runId: string }, AgentQueueItem[]];
  "agents/checkpoints": [{ runId: string }, AgentCheckpoint[]];
  "agents/plans": [{ runId: string }, AgentPlan[]];
  "agents/export": [{ runId: string }, AgentRunSnapshot];
  "agents/import": [
    { snapshot: AgentRunSnapshot; workspace?: Partial<AgentWorkspace> },
    AgentRun,
  ];
  "agents/automations": [undefined, AgentAutomation[]];
  "agents/automationControl": [
    AgentAutomationControlRequest,
    AgentAutomation | AgentRun | void,
  ];
  "reviews/list": [undefined, ReviewReport[]];
  "reviews/get": [{ reportId: string }, ReviewReport | undefined];
  "reviews/run": [CreateReviewRequest, ReviewReport];
  "reviews/cancel": [{ reportId: string }, ReviewReport];
  "reviews/action": [ReviewActionRequest, ReviewActionResult];
  "reviews/comments": [{ findingId: string }, ReviewFindingComment[]];
  "terminal/classify": [
    { command: string; basePolicy: ToolPolicy; sandboxed?: boolean },
    TerminalCommandClassification,
  ];
  "terminal/jobs": [undefined, TerminalJob[]];
  "terminal/jobStart": [{ command: string; cwd: string }, TerminalJob];
  "terminal/jobOutput": [{ jobId: string }, string];
  "terminal/jobStop": [{ jobId: string }, TerminalJob];
  "extensions/skills": [
    undefined,
    {
      skills: Array<{
        name: string;
        description: string;
        path: string;
        sourceFile?: string;
        provenance?: string;
        readOnly?: boolean;
        scope?: "workspace" | "global";
        content: string;
        files: string[];
      }>;
      errors: Array<{ message: string; fatal?: boolean }>;
    },
  ];
  "extensions/plugins": [undefined, InstalledLocalPlugin[]];
  "extensions/pluginInstall": [{ sourcePath: string }, InstalledLocalPlugin];
  "extensions/pluginSetEnabled": [
    { id: string; enabled: boolean },
    InstalledLocalPlugin,
  ];
  "extensions/pluginUninstall": [{ id: string }, void];
  "extensions/codexImportPreview": [undefined, CodexImportInventory];
  "extensions/codexImportApply": [
    ApplyCodexImportRequest,
    ApplyCodexImportResult,
  ];
  "extensions/codexImportSetEnabled": [
    SetCodexImportItemEnabledRequest,
    ApplyCodexImportResult,
  ];
  "extensions/skillSave": [
    {
      name: string;
      description: string;
      content: string;
      scope: "workspace" | "global";
      sourceFile?: string;
    },
    {
      name: string;
      description: string;
      path: string;
      sourceFile?: string;
      provenance?: string;
      readOnly?: boolean;
      scope?: "workspace" | "global";
      content: string;
      files: string[];
    },
  ];
  "browser/list": [undefined, BrowserSession[]];
  "browser/create": [CreateBrowserSessionRequest, BrowserSession];
  "browser/action": [BrowserActionRequest, BrowserActionResult];
  "browser/events": [
    { sessionId: string; afterSequence?: number },
    BrowserEvent[],
  ];
  "browser/grants": [{ sessionId?: string }, BrowserPermissionGrant[]];
  "browser/grant": [
    {
      sessionId: string;
      action: BrowserPermissionGrant["action"];
      origin?: string;
      expiresAt?: string;
    },
    BrowserPermissionGrant,
  ];
  "browser/revokeGrant": [{ sessionId: string; grantId: string }, void];
  "slack/status": [undefined, SlackAuthorization | undefined];
  "slack/authorize": [
    {
      token: string;
      channelIds: string[];
      allowRead?: boolean;
      allowWrite?: boolean;
    },
    SlackAuthorization,
  ];
  "slack/revoke": [undefined, void];
  "slack/channels": [undefined, SlackChannel[]];
  "slack/messages": [{ channelId: string; limit?: number }, SlackMessage[]];
  "slack/post": [
    { channelId: string; text: string; threadTimestamp?: string },
    SlackMessage,
  ];
};
export type ToWebviewFromCoreProtocol = ToWebviewFromIdeOrCoreProtocol;
