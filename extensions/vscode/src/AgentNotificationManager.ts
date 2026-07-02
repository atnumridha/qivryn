import { FileAgentStore, type AgentRun } from "@qivryn/agent-runtime";
import { getQivrynGlobalPath } from "core/util/paths";
import path from "node:path";
import * as vscode from "vscode";
import {
  agentNotificationMessage,
  type AgentNotificationMode,
  shouldNotifyAgent,
} from "./agentNotificationPolicy";

const TERMINAL_STATUSES = new Set<AgentRun["status"]>([
  "completed",
  "failed",
  "attention",
]);

export class AgentNotificationManager implements vscode.Disposable {
  private readonly store = new FileAgentStore(
    path.join(getQivrynGlobalPath(), "agents"),
  );
  private readonly timer: NodeJS.Timeout;
  private ready = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    void this.store.initialize();
    this.timer = setInterval(() => void this.poll(), 1_500);
    this.timer.unref();
    void this.poll();
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    await this.store.initialize();
    const runs = await this.store.listRuns({ limit: 200 });
    if (!this.ready) {
      for (const run of runs) {
        await this.context.globalState.update(this.key(run), run.updatedAt);
      }
      this.ready = true;
      return;
    }
    const config = vscode.workspace.getConfiguration("qivryn");
    const mode = config.get<AgentNotificationMode>(
      "agentCompletionNotifications",
      "whenUnfocused",
    );
    if (mode === "off") return;
    const includeTitle = config.get<boolean>(
      "agentNotificationIncludeTaskTitle",
      false,
    );
    for (const run of runs) {
      if (!run.unread || !TERMINAL_STATUSES.has(run.status)) continue;
      if (
        this.context.globalState.get<string>(this.key(run)) === run.updatedAt
      ) {
        continue;
      }
      await this.context.globalState.update(this.key(run), run.updatedAt);
      if (!shouldNotifyAgent(mode, vscode.window.state.focused)) continue;
      const selection = await vscode.window.showInformationMessage(
        agentNotificationMessage(run, includeTitle),
        "Open agent",
        "Quiet",
      );
      if (selection === "Open agent") {
        await vscode.commands.executeCommand(
          "qivryn.navigateTo",
          `/agents?runId=${encodeURIComponent(run.id)}`,
          false,
        );
      } else if (selection === "Quiet") {
        await config.update(
          "agentCompletionNotifications",
          "off",
          vscode.ConfigurationTarget.Global,
        );
      }
    }
  }

  private key(run: AgentRun): string {
    return `qivryn.agentNotification.${run.id}`;
  }
}
