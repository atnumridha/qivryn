import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

// ─── Auth file paths ─────────────────────────────────────────────────────────
// The auth file is written by the codex-oca-bridge VS Code extension when the
// user runs "Codex Copilot: Export Token and Enable".  Structure:
//   {
//     github_token:  "<GitHub OAuth token>",   // long-lived, used for refresh
//     token:         "<Copilot bearer token>",  // short-lived (~30 min)
//     expires_at:    1234567890,                // Unix seconds
//     capi_base:     "https://api.githubcopilot.com",
//     endpoints:     { api: "https://…" }
//   }
const AUTH_FILE = path.join(os.homedir(), ".codex", "copilot-auth.json");

const GITHUB_API = "https://api.github.com";
const DEFAULT_CAPI_BASE = "https://api.githubcopilot.com";

// Refresh the bearer token this many seconds before it actually expires.
const REFRESH_SKEW_SECONDS = 300;

interface CopilotAuth {
  github_token?: string;
  githubAccessToken?: string;
  token?: string;
  copilot_token?: string;
  expires_at?: number;
  expiresAt?: number;
  capi_base?: string;
  capiBase?: string;
  endpoints?: { api?: string };
  editor_version?: string;
  editorVersion?: string;
  editor_plugin_version?: string;
  editorPluginVersion?: string;
}

function readAuthFile(): CopilotAuth {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `GitHub Copilot auth file not found: ${AUTH_FILE}\n` +
        `Run the VS Code command "Codex Copilot: Export Token and Enable" to create it.\n` +
        `See ~/Documents/codex-oca-tool/docs/macos.md for setup instructions.`,
    );
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as CopilotAuth;
}

function githubToken(auth: CopilotAuth): string {
  return auth.github_token ?? auth.githubAccessToken ?? "";
}

function copilotBearer(auth: CopilotAuth): string {
  return auth.token ?? auth.copilot_token ?? "";
}

function bearerExpiry(auth: CopilotAuth): number {
  return Number(auth.expires_at ?? auth.expiresAt ?? 0);
}

function capiBase(auth: CopilotAuth): string {
  return (
    auth.endpoints?.api ??
    auth.capi_base ??
    auth.capiBase ??
    DEFAULT_CAPI_BASE
  ).replace(/\/+$/, "");
}

function bearerNeedsRefresh(auth: CopilotAuth): boolean {
  const bearer = copilotBearer(auth);
  if (!bearer) return true;
  const exp = bearerExpiry(auth);
  if (!exp) return false; // no expiry info — assume still valid
  return exp - Math.floor(Date.now() / 1000) <= REFRESH_SKEW_SECONDS;
}

function writeAuthFile(auth: CopilotAuth): void {
  const dir = path.dirname(AUTH_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${AUTH_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* ignore */
  }
  fs.renameSync(tmp, AUTH_FILE);
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

// Module-level in-flight promise so concurrent requests share one refresh.
let refreshInFlight: Promise<CopilotAuth> | undefined;

async function refreshBearer(auth: CopilotAuth): Promise<CopilotAuth> {
  const ghToken = githubToken(auth);
  if (!ghToken) {
    const bearer = copilotBearer(auth);
    const exp = bearerExpiry(auth);
    if (bearer && exp && exp > Math.floor(Date.now() / 1000)) {
      // No GitHub token but bearer is still valid — use it.
      return auth;
    }
    throw new Error(
      `The Copilot bearer token in ${AUTH_FILE} has expired and there is no GitHub OAuth ` +
        `token available for automatic renewal.\n` +
        `Re-run "Codex Copilot: Export Token and Enable" in VS Code to refresh it.`,
    );
  }

  const url = `${GITHUB_API}/copilot_internal/v2/token`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: "application/json",
      "X-GitHub-Api-Version": "2025-04-01",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub Copilot token refresh failed (${res.status} ${res.statusText}): ${body}`,
    );
  }

  const envelope = (await res.json()) as any;
  if (!envelope.token) {
    throw new Error(
      `GitHub Copilot token response did not include a bearer token.\n` +
        `Response: ${JSON.stringify(envelope)}`,
    );
  }

  const next: CopilotAuth = {
    ...auth,
    token: envelope.token,
    expires_at: Number(envelope.expires_at) || undefined,
    expiresAt: Number(envelope.expires_at) || undefined,
    capi_base: envelope.endpoints?.api ?? auth.capi_base ?? DEFAULT_CAPI_BASE,
    capiBase: envelope.endpoints?.api ?? auth.capiBase ?? DEFAULT_CAPI_BASE,
    endpoints: envelope.endpoints ?? auth.endpoints ?? {},
  };
  writeAuthFile(next);
  return next;
}

async function loadAuth(): Promise<CopilotAuth> {
  const auth = readAuthFile();
  if (!bearerNeedsRefresh(auth)) return auth;

  // Coalesce concurrent refreshes into one.
  if (!refreshInFlight) {
    refreshInFlight = refreshBearer(auth).finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

/**
 * GitHubCopilot LLM provider for Qivryn.
 *
 * Talks **directly** to the GitHub Copilot API (`api.githubcopilot.com`)
 * with no local proxy, no daemon, and no external process.
 *
 * Auth is managed automatically:
 *  - Reads `~/.codex/copilot-auth.json` (written by the codex-oca-bridge
 *    VS Code extension — see ~/Documents/codex-oca-tool).
 *  - Refreshes the short-lived Copilot bearer token when it is about to
 *    expire, using the long-lived GitHub OAuth token stored in the same file.
 *  - Writes the refreshed token back to the auth file.
 *
 * Setup (one time):
 *   1. Install the VS Code extension:
 *        cd ~/Documents/codex-oca-tool && bash install.sh --copilot-setup
 *   2. Run from VS Code Command Palette:
 *        Codex Copilot: Export Token and Enable
 *      This writes ~/.codex/copilot-auth.json.
 *   3. Add this provider to ~/.qivryn/config.yaml (see setup script).
 *
 * No proxy, no port, no background process required.
 */
class GitHubCopilot extends OpenAI {
  static providerName = "github-copilot";

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: `${DEFAULT_CAPI_BASE}/`,
    model: "gpt-5.3-codex",
    useLegacyCompletionsEndpoint: false,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  /** Cached auth so we don't re-read the file on every request. */
  private _cachedAuth: CopilotAuth | undefined;

  private async _getAuth(): Promise<CopilotAuth> {
    this._cachedAuth = await loadAuth();
    // Keep apiBase and apiKey in sync after each load/refresh.
    const base = capiBase(this._cachedAuth);
    this.apiBase = base.endsWith("/") ? base : `${base}/`;
    this.apiKey = copilotBearer(this._cachedAuth);
    return this._cachedAuth;
  }

  /** Override fetch so auth is always fresh before each request. */
  async fetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    await this._getAuth();
    // Inject the fresh headers into the outgoing request.
    const merged: RequestInit = {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        ...this._copilotHeaders(),
      },
    };
    return super.fetch(url, merged);
  }

  private _copilotHeaders(): Record<string, string> {
    const bearer = this._cachedAuth
      ? copilotBearer(this._cachedAuth)
      : (this.apiKey ?? "");

    const editorVersion =
      this._cachedAuth?.editor_version ??
      this._cachedAuth?.editorVersion ??
      "vscode/unknown";

    const pluginVersion =
      this._cachedAuth?.editor_plugin_version ??
      this._cachedAuth?.editorPluginVersion ??
      "copilot-chat/qivryn";

    return {
      Authorization: `Bearer ${bearer}`,
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": editorVersion,
      "Editor-Plugin-Version": pluginVersion,
      "OpenAI-Intent": "conversation",
      "X-Interaction-Type": "conversation",
      "X-GitHub-Api-Version": "2026-06-01",
    };
  }

  protected override _getHeaders() {
    return {
      "Content-Type": "application/json",
      "api-key": "", // not used by Copilot; present to satisfy base class signature
      ...this._copilotHeaders(),
    };
  }
}

export default GitHubCopilot;
