import type { AgentRuntimeStatus } from "@qivryn/agent-runtime";
import type { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import type { InProcessMessenger } from "core/protocol/messenger";
import * as vscode from "vscode";
import { nextAgentRuntimeRetryDelay } from "./agentRuntimeRetryPolicy";

type CoreMessenger = InProcessMessenger<ToCoreProtocol, FromCoreProtocol>;

export class AgentRuntimeRecoveryManager implements vscode.Disposable {
  private disposed = false;
  private timer?: NodeJS.Timeout;
  private attempt = 0;
  private notificationShown = false;

  constructor(private readonly messenger: CoreMessenger) {
    void this.check();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async retryNow(): Promise<void> {
    this.attempt = 0;
    this.notificationShown = false;
    if (this.timer) clearTimeout(this.timer);
    await this.check();
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    let status: AgentRuntimeStatus;
    try {
      status = await this.messenger.externalRequest("agents/status", undefined);
    } catch (error) {
      status = {
        state: "unavailable",
        checkedAt: new Date().toISOString(),
        source: "path",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.agentRuntimeState",
      status.state,
    );
    if (status.state === "ready") {
      this.attempt = 0;
      this.notificationShown = false;
      return;
    }
    const delay = nextAgentRuntimeRetryDelay(this.attempt++);
    if (delay !== undefined) {
      this.timer = setTimeout(() => void this.check(), delay);
      this.timer.unref?.();
      return;
    }
    if (this.notificationShown) return;
    this.notificationShown = true;
    const selection = await vscode.window.showErrorMessage(
      status.message ?? "The Qivryn agent runtime is unavailable.",
      "Retry",
      "Reload Window",
      "Open Logs",
    );
    if (selection === "Retry") await this.retryNow();
    else if (selection === "Reload Window") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else if (selection === "Open Logs") {
      await vscode.commands.executeCommand("workbench.action.openLogsFolder");
    }
  }
}
