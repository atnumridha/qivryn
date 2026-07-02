import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OpenAI } from "openai/index";
import { customFetch } from "../util.js";
import { OpenAIApi } from "./OpenAI.js";
import { OpenAIConfig } from "../types.js";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
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

function githubToken(a: CopilotAuth): string {
  return a.github_token ?? a.githubAccessToken ?? "";
}
function copilotBearer(a: CopilotAuth): string {
  return a.token ?? a.copilot_token ?? "";
}
function bearerExpiry(a: CopilotAuth): number {
  return Number(a.expires_at ?? a.expiresAt ?? 0);
}
function capiBaseOf(a: CopilotAuth): string {
  return (
    a.endpoints?.api ??
    a.capi_base ??
    a.capiBase ??
    DEFAULT_CAPI_BASE
  ).replace(/\/+$/, "");
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
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* ok */
  }
  fs.renameSync(tmp, AUTH_FILE);
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    /* ok */
  }
}

let refreshInFlight: Promise<CopilotAuth> | undefined;

async function refreshBearer(auth: CopilotAuth): Promise<CopilotAuth> {
  const ghToken = githubToken(auth);
  if (!ghToken) {
    const bearer = copilotBearer(auth);
    const exp = bearerExpiry(auth);
    if (bearer && exp && exp > Math.floor(Date.now() / 1000)) return auth;
    throw new Error(
      `Copilot bearer expired and no GitHub OAuth token is available for renewal. ` +
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
    throw new Error(
      `Copilot token refresh failed: ${res.status} ${res.statusText}`,
    );
  }
  const envelope = (await res.json()) as Record<string, any>;
  if (!envelope["token"]) {
    throw new Error("Copilot token response missing token field.");
  }
  const next: CopilotAuth = {
    ...auth,
    token: envelope["token"] as string,
    expires_at: Number(envelope["expires_at"]) || undefined,
    expiresAt: Number(envelope["expires_at"]) || undefined,
    capi_base:
      (envelope["endpoints"] as any)?.api ??
      auth.capi_base ??
      DEFAULT_CAPI_BASE,
    capiBase:
      (envelope["endpoints"] as any)?.api ?? auth.capiBase ?? DEFAULT_CAPI_BASE,
    endpoints: (envelope["endpoints"] as any) ?? auth.endpoints ?? {},
  };
  writeAuthFile(next);
  return next;
}

async function loadAuth(): Promise<CopilotAuth> {
  const auth = readAuthFile();
  if (!needsRefresh(auth)) return auth;
  if (!refreshInFlight) {
    refreshInFlight = refreshBearer(auth).finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

/**
 * Build the Copilot request headers per the verified API spec in
 * docs/copilot-direct-api.md.
 *
 * Two header sets:
 *   conversation – used for chat/completions, responses, fim
 *   model-access – used for /models list
 */
function copilotHeaders(
  auth: CopilotAuth,
  intent: "conversation" | "model-access" = "conversation",
): Record<string, string> {
  const editorVersion =
    auth.editor_version ?? auth.editorVersion ?? "vscode/unknown";
  const pluginVersion =
    auth.editor_plugin_version ??
    auth.editorPluginVersion ??
    "copilot-chat/qivryn";
  return {
    Authorization: `Bearer ${copilotBearer(auth)}`,
    "Copilot-Integration-Id": "vscode-chat",
    "Editor-Version": editorVersion,
    "Editor-Plugin-Version": pluginVersion,
    "X-GitHub-Api-Version": "2026-06-01",
    "OpenAI-Intent": intent,
    "X-Interaction-Type": intent,
  };
}

export interface GitHubCopilotConfig extends OpenAIConfig {}

/**
 * GitHubCopilot API adapter for Qivryn.
 *
 * Talks directly to api.githubcopilot.com — no proxy or daemon.
 *
 * A custom fetch wrapper is injected into the OpenAI client at construction.
 * Before every HTTP request it:
 *   1. Calls loadAuth() to get a fresh bearer token (auto-refreshes via the
 *      GitHub OAuth token stored in ~/.codex/copilot-auth.json)
 *   2. Injects the required Copilot headers (Authorization, Copilot-Integration-Id,
 *      Editor-Version, OpenAI-Intent, X-Interaction-Type, X-GitHub-Api-Version)
 *
 * All OpenAI SDK methods (chat, embed, fim, responses…) therefore always carry
 * a valid token without any method signature overrides.
 *
 * Routing (per copilot-direct-api.md):
 *   - GPT models advertising /responses  → OpenAI Responses API
 *   - All other GPT + all Claude models  → /chat/completions
 *
 * @see ~/Documents/codex-oca-tool/docs/copilot-direct-api.md
 */
export class GitHubCopilotApi extends OpenAIApi {
  constructor(config: GitHubCopilotConfig) {
    const base = config.apiBase ?? `${DEFAULT_CAPI_BASE}/`;
    const baseFetch = customFetch(config.requestOptions);

    // Token-aware fetch: refreshes bearer and injects Copilot headers before
    // every request the OpenAI SDK makes.
    const tokenAwareFetch = async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ): Promise<globalThis.Response> => {
      const auth = await loadAuth();

      // Detect intent from the URL so /models gets model-access headers.
      const url =
        typeof input === "string" ? input : (input as URL | Request).toString();
      const intent: "conversation" | "model-access" =
        url.endsWith("/models") || url.includes("/models?")
          ? "model-access"
          : "conversation";

      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
        ...copilotHeaders(auth, intent),
      };
      return baseFetch(input as any, { ...init, headers } as any) as any;
    };

    super({
      ...config,
      apiBase: base,
      // A non-empty placeholder — the real token is injected per-request by
      // tokenAwareFetch. This prevents the OpenAI client from throwing on init.
      apiKey: config.apiKey ?? "copilot-will-refresh",
    });

    // Replace the openai client with one that uses our token-aware fetch.
    this.openai = new OpenAI({
      apiKey: "copilot-will-refresh",
      baseURL: base,
      fetch: tokenAwareFetch,
      timeout: config.requestOptions?.timeout || undefined,
    });
  }

  /**
   * Synchronous header override for code paths that call getHeaders() directly
   * (e.g. the fim / rerank code that builds its own fetch call).
   * Uses the last-read auth file when available; falls back to minimal headers.
   */
  protected override getHeaders(): Record<string, string> {
    try {
      const auth = readAuthFile();
      if (!needsRefresh(auth)) {
        return {
          "Content-Type": "application/json",
          ...copilotHeaders(auth, "conversation"),
        };
      }
    } catch {
      /* auth file not yet present */
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey ?? ""}`,
      "Copilot-Integration-Id": "vscode-chat",
      "X-GitHub-Api-Version": "2026-06-01",
      "OpenAI-Intent": "conversation",
      "X-Interaction-Type": "conversation",
    };
  }

  /**
   * Copilot CAPI serves /chat/completions for all models and /responses only
   * for models that explicitly advertise it.  Because we don't know which
   * endpoint a given model supports without calling /models first, we default
   * to /chat/completions here (same as the proxy).  Override shouldUseResponsesEndpoint
   * so the parent class doesn't try to route to the OpenAI Responses API URL.
   */
  protected override shouldUseResponsesEndpoint(_model: string): boolean {
    return false;
  }

  override modifyChatBody<
    T extends import("openai/resources/index").ChatCompletionCreateParams,
  >(body: T): T {
    const modified = super.modifyChatBody(body);
    // Inject reasoning_effort if present (set via requestOptions.extraBodyProperties in config)
    const reasoningEffort =
      (modified as any).reasoning_effort || (modified as any).reasoningEffort;
    if (reasoningEffort) {
      (modified as any).reasoning = { effort: reasoningEffort };
      delete (modified as any).reasoning_effort;
      delete (modified as any).reasoningEffort;
    }
    return modified;
  }
}

export default GitHubCopilotApi;
