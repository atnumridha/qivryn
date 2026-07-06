import type { BrowserSession } from "@qivryn/agent-runtime";
import type { Core } from "core/core";
import * as vscode from "vscode";

export class NativeBrowserEditor implements vscode.Disposable {
  private activeSession?: BrowserSession;
  private panel?: vscode.WebviewPanel;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly core: Core,
  ) {
    context.subscriptions.push(this);
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.panel?.dispose();
  }

  async open(url?: string): Promise<void> {
    let session: BrowserSession | undefined;
    if (url) {
      session = await this.create(url);
    } else {
      const sessions = await this.core.invoke("browser/list", undefined);
      const selected = await vscode.window.showQuickPick(
        [
          {
            label: "$(add) New browser session",
            description: "Open a URL in Qivryn",
          },
          ...sessions.map((candidate) => ({
            label: candidate.title || candidate.url || "Browser session",
            description: candidate.url,
            detail:
              candidate.recording === "off" ? undefined : "Recording enabled",
            session: candidate,
          })),
        ],
        { title: "Qivryn Browser", placeHolder: "Open or create a session" },
      );
      if (!selected) return;
      session = "session" in selected ? selected.session : undefined;
      if (!session) {
        const input = await vscode.window.showInputBox({
          title: "New Qivryn Browser Session",
          prompt: "Enter a URL",
          value: "http://localhost:3000",
          ignoreFocusOut: true,
        });
        if (!input?.trim()) return;
        session = await this.create(input.trim());
      }
    }
    if (!session?.url) return;
    this.activeSession = session;
    await this.showSession();
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.activeBrowserSession",
      session.id,
    );
  }

  back(): Promise<void> {
    return this.navigate("back");
  }

  forward(): Promise<void> {
    return this.navigate("forward");
  }

  reload(): Promise<void> {
    return this.navigate("reload");
  }

  async takeover(): Promise<void> {
    const session = this.requireActive();
    this.activeSession = (await this.core.invoke("browser/action", {
      action: "takeover",
      sessionId: session.id,
      actor: "user",
    })) as BrowserSession;
    await this.render();
    void vscode.window.showInformationMessage(
      "You now control this browser session.",
    );
  }

  async screenshot(): Promise<void> {
    const session = this.requireActive();
    const result = (await this.core.invoke("browser/action", {
      action: "screenshot",
      sessionId: session.id,
      actor: "user",
    })) as { data?: string; mediaType?: string };
    if (!result?.data)
      throw new Error("The browser did not return a screenshot");
    const directory = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "browser-artifacts",
    );
    await vscode.workspace.fs.createDirectory(directory);
    const filepath = vscode.Uri.joinPath(
      directory,
      `${session.id}-${Date.now()}.png`,
    );
    await vscode.workspace.fs.writeFile(
      filepath,
      Uint8Array.from(Buffer.from(result.data, "base64")),
    );
    await vscode.commands.executeCommand("vscode.open", filepath);
  }

  private async create(url: string): Promise<BrowserSession> {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return this.core.invoke("browser/create", {
      url: normalized,
      visible: true,
      recording: "events",
    });
  }

  private async navigate(action: "back" | "forward" | "reload"): Promise<void> {
    const session = this.requireActive();
    this.activeSession = (await this.core.invoke("browser/action", {
      action,
      sessionId: session.id,
      actor: "user",
    })) as BrowserSession;
    await this.render();
  }

  private async showSession(): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "qivryn.browserSession",
        "Qivryn Browser",
        vscode.ViewColumn.One,
        { enableScripts: false, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = undefined;
      });
    }
    this.panel.reveal(vscode.ViewColumn.One, false);
    await this.render();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => void this.render(), 1_000);
    this.refreshTimer.unref?.();
  }

  private async render(): Promise<void> {
    if (!this.panel || !this.activeSession) return;
    try {
      const result = (await this.core.invoke("browser/action", {
        action: "screenshot",
        sessionId: this.activeSession.id,
        actor: "user",
      })) as { data?: string; mediaType?: string };
      if (!result.data) return;
      this.panel.title = this.activeSession.title || "Qivryn Browser";
      this.panel.webview.html = browserHtml(
        this.activeSession,
        result.data,
        result.mediaType ?? "image/png",
      );
    } catch (error) {
      this.panel.webview.html = browserErrorHtml(error);
    }
  }

  private requireActive(): BrowserSession {
    if (!this.activeSession)
      throw new Error("Open a Qivryn browser session first");
    return this.activeSession;
  }
}

function browserHtml(
  session: BrowserSession,
  data: string,
  mediaType: string,
): string {
  const locked = session.locked
    ? `Controlled by ${escapeHtml(session.lockOwner ?? "another actor")}`
    : "Shared session";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:0;background:#111;color:#ccc;font:12px system-ui}.bar{display:flex;gap:12px;padding:8px 12px;border-bottom:1px solid #333}.url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}img{display:block;max-width:100%;margin:auto}</style></head><body><div class="bar"><span class="url">${escapeHtml(session.url ?? "about:blank")}</span><span>${locked}</span><span>${escapeHtml(session.recording)}</span></div><img alt="Live browser session" src="data:${escapeHtml(mediaType)};base64,${data}"></body></html>`;
}

function browserErrorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!doctype html><html><body><p>Browser session unavailable: ${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
