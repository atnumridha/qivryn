import * as vscode from "vscode";
import {
  isNewerRelease,
  nextReleaseUpdateRetryDelay,
  releaseVersionFromTag,
} from "./releaseUpdatePolicy";

interface GitHubRelease {
  html_url?: string;
  tag_name?: string;
}

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/atnumridha/qivryn/releases/latest";

export class ReleaseUpdateManager implements vscode.Disposable {
  private disposed = false;
  private timer?: NodeJS.Timeout;
  private attempt = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    void this.check(false);
    context.subscriptions.push(
      vscode.commands.registerCommand("qivryn.checkForUpdates", () =>
        this.check(true),
      ),
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async check(explicit: boolean): Promise<void> {
    if (this.disposed) return;
    try {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Qivryn/${this.context.extension.packageJSON.version}`,
        },
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const release = (await response.json()) as GitHubRelease;
      const candidate = releaseVersionFromTag(release.tag_name ?? "");
      const current = String(this.context.extension.packageJSON.version);
      this.attempt = 0;
      if (candidate && isNewerRelease(current, candidate)) {
        const selection = await vscode.window.showInformationMessage(
          `Qivryn ${candidate} is available.`,
          "Download Update",
          "Reload Window",
        );
        if (selection === "Download Update" && release.html_url) {
          await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
        } else if (selection === "Reload Window") {
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } else if (explicit) {
        await vscode.window.showInformationMessage("Qivryn is up to date.");
      }
    } catch (error) {
      const delay = nextReleaseUpdateRetryDelay(this.attempt++);
      if (!explicit && delay !== undefined) {
        this.timer = setTimeout(() => void this.check(false), delay);
        this.timer.unref?.();
        return;
      }
      if (!explicit) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Qivryn could not check for updates: ${message}`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const selection = await vscode.window.showErrorMessage(
        `Qivryn could not check for updates: ${message}`,
        "Retry",
        "Reload Window",
        "Open Logs",
      );
      if (selection === "Retry") {
        this.attempt = 0;
        await this.check(true);
      } else if (selection === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } else if (selection === "Open Logs") {
        await vscode.commands.executeCommand("workbench.action.openLogsFolder");
      }
    }
  }
}
