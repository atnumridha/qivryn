import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OpenAI } from "openai/index";
import { customFetch } from "../util.js";
import { OpenAIApi } from "./OpenAI.js";
import { OpenAIConfig } from "../types.js";

const AUTH_FILE = path.join(os.homedir(), ".codex", "copilot-auth.json");
const GITHUB_API = "https://api.github.com";
const DEFAULT_CAPI_BASE = "https://api.githubcopilot.com";
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
      `GitHub Copilot auth file not found: ${AUTH_FILE}. ` +
        `Run "Codex Copilot: Export Token and Enable" in VS Code.`,
    );
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as CopilotAuth;
}

function githubToken(a: CopilotAuth) { return a.github_token ?? a.githubAccessToken ?? ""; }
function copilotBearer(a: CopilotAuth) { return a.token ?? a.copilot_token ?? ""; }
function bearerExpiry(a: CopilotAuth) { return Number(a.expires_at ?? a.expiresAt ?? 0); }
function capiBaseOf(a: CopilotAuth) {
  return (a.endpoints?.api ?? a.capi_base ?? a.capiBase ?? DEFAULT_CAPI_BASE).replace(/\/+$/, "");
}

function needsRefresh(a: CopilotAuth): boolean {
  if (!copilotBearer(a)) return true;
  const exp = bearerExpiry(a);
  if (!exp) return false;
  return exp - Math.floor(Date.now() / 1000) <= REFRESH_SKEW_SECONDS;
}

function writeAuthFile(a: CopilotAuth): void {
  const dir = path.dirname(AUTH_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${AUTH_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* ok */ }
  fs.renameSync(tmp, AUTH_FILE);
  try { fs.chmodSync(AUTH_FILE, 0o600); } catch { /* ok */ }
}

let refreshInFlight: Promise<CopilotAuth> | undefined;

async function refreshBearer(auth: CopilotAuth): Promise<CopilotAuth> {
  const ghToken = githubToken(auth);
  if (!ghToken) {
    const bearer = copilotBearer(auth);
    const exp = bearerExpiry(auth);
    if (bearer && exp && exp > Math.floor(Date.now() / 1000)) return auth;
    throw new Error(
      `Copilot bearer token expired and no GitHub OAuth token is available for renewal. ` +
        `Re-run "Codex Copilot: Export Token and Enable" in VS Code.`,
    );
  }

  const res = await fetch(`${GITHUB_API}/copilot_internal/v2/token`, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: "application/json",
      "X-GitHub-Api-Version": "2025-04-01",
    },
  });
  if (!res.ok) {
    throw new Error(`Copilot token refresh failed: ${res.status} ${res.statusText}`);
  }
  const envelope = await res.json() as any;
  if (!envelope.token) throw new Error("Copilot token response missing token field.");

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
  if (!needsRefresh(auth)) return auth;
  if (!refreshInFlight) {
    refreshInFlight = refreshBearer(auth).finally(() => { refreshInFlight = undefined; });
  }
  return refreshInFlight;
}

export interface GitHubCopilotConfig extends OpenAIConfig {}

/**
 * GitHubCopilot API adapter for Continue's openai-adapters package.
 *
 * Talks directly to api.githubcopilot.com — no proxy or daemon needed.
 * Auto-refreshes the Copilot bearer token using the GitHub OAuth token
 * stored in ~/.codex/copilot-auth.json (written by codex-oca-bridge).
 */
export class GitHubCopilotApi extends OpenAIApi {
  private copilotAuth: CopilotAuth | undefined;

  constructor(config: GitHubCopilotConfig) {
    // Use the config apiBase or fall back to Copilot's CAPI endpoint.
    super({
      ...config,
      apiBase: config.apiBase ?? `${DEFAULT_CAPI_BASE}/`,
    });
  }

  /** Ensure token is fresh, then rebuild the internal openai client. */
  private async ensureAuth(): Promise<void> {
    this.copilotAuth = await loadAuth();
    const base = `${capiBaseOf(this.copilotAuth)}/`;
    const bearer = copilotBearer(this.copilotAuth);
    // Rebuild the OpenAI client with the refreshed token and correct base URL.
    this.openai = new OpenAI({
      apiKey: bearer,
      baseURL: base,
      fetch: customFetch(this.config.requestOptions),
      timeout: this.config.requestOptions?.timeout || undefined,
      defaultHeaders: this.getHeaders(),
    });
    this.apiBase = base;
  }

  protected override getHeaders(): Record<string, string> {
    const bearer = this.copilotAuth
      ? copilotBearer(this.copilotAuth)
      : this.config.apiKey ?? "";
    const auth = this.copilotAuth ?? {};
    const editorVersion = (auth as any).editor_version ?? (auth as any).editorVersion ?? "vscode/unknown";
    const pluginVersion = (auth as any).editor_plugin_version ?? (auth as any).editorPluginVersion ?? "copilot-chat/continue";
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": editorVersion,
      "Editor-Plugin-Version": pluginVersion,
      "OpenAI-Intent": "conversation",
      "X-GitHub-Api-Version": "2026-06-01",
    };
  }

  // ── Delegate all API calls through ensureAuth so token is always fresh ────

  override async chatCompletionStream(body: any, signal: AbortSignal) {
    await this.ensureAuth();
    return super.chatCompletionStream(body, signal);
  }

  override async chatCompletionNonStream(body: any, signal: AbortSignal) {
    await this.ensureAuth();
    return super.chatCompletionNonStream(body, signal);
  }

  override async *fimStream(body: any, signal: AbortSignal) {
    await this.ensureAuth();
    yield* super.fimStream(body, signal);
  }

  override async embed(body: any) {
    await this.ensureAuth();
    return super.embed(body);
  }

  override async listModels(): Promise<any[]> {
    await this.ensureAuth();
    return super.listModels();
  }

  override async *streamResponse(params: any, signal: AbortSignal) {
    await this.ensureAuth();
    yield* super.streamResponse(params, signal);
  }

  override async createResponse(params: any, signal: AbortSignal) {
    await this.ensureAuth();
    return super.createResponse(params, signal);
  }
}

export default GitHubCopilotApi;
