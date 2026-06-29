/**
 * ChatGPTCodex API adapter for Continue.
 *
 * Connects directly to the ChatGPT Codex backend used by Codex Desktop/CLI:
 *   POST https://chatgpt.com/backend-api/codex/responses
 *
 * Auth is read from ~/.codex/auth.json:
 *   - Bearer token: .tokens.access_token  (short-lived)
 *   - Refresh token: .tokens.refresh_token (used to obtain a new access token)
 *
 * This endpoint is NOT the public OpenAI Platform API (api.openai.com).
 * The request shape uses `instructions` (system message) and a list-form
 * `input` instead of the standard `messages` array.
 *
 * @see ~/Documents/codex-oca-tool/docs/chatgpt-backend-api.md (or the notes
 *      pasted into the session) for the verified curl shape.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { streamSse } from "@continuedev/fetch";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  Completion,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  Model,
} from "openai/resources/index";

import {
  BaseLlmApi,
  CreateRerankResponse,
  FimCreateParamsStreaming,
  RerankCreateParams,
} from "./base.js";
import {
  createResponsesStreamState,
  fromResponsesChunk,
  toResponsesInput,
} from "./openaiResponses.js";

// ── Structured API error ────────────────────────────────────────────────────
export interface ApiErrorDetails {
  status: number;
  url: string;
  model: string;
  body: string;
}

/** Rich error that carries the full HTTP response so the UI can display and copy it. */
export class CodexApiError extends Error {
  readonly details: ApiErrorDetails;

  constructor(message: string, details: ApiErrorDetails) {
    // Format the full diagnostic block as the error message so it shows up
    // verbatim in Continue's error panel and can be copied with one click.
    const parsed = (() => {
      try {
        return JSON.stringify(JSON.parse(details.body), null, 2);
      } catch {
        return details.body;
      }
    })();
    const fullMessage =
      `${message}

` +
      `URL: ${details.url}
` +
      `Model: ${details.model}
` +
      `Status: ${details.status}

` +
      `Response:
${parsed}`;
    super(fullMessage);
    this.name = "CodexApiError";
    this.details = details;
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
const AUTH_FILE = path.join(os.homedir(), ".codex", "auth.json");
const INSTALL_ID_FILE = path.join(os.homedir(), ".codex", "installation_id");
const MODELS_CACHE_FILE = path.join(
  os.homedir(),
  ".codex",
  "models_cache.json",
);

const CODEX_BASE = "https://chatgpt.com/backend-api/codex";
const REFRESH_URL = "https://chatgpt.com/backend-api/auth/refresh";
const REFRESH_SKEW_SECONDS = 120;

interface CodexAuth {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_at?: number;
    expiresAt?: number;
  };
  last_refresh?: string;
}

function readAuthFile(): CodexAuth {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `Codex auth file not found: ${AUTH_FILE}.\n` +
        `Sign in to Codex Desktop or CLI first, then retry.`,
    );
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as CodexAuth;
}

function getAccessToken(auth: CodexAuth): string {
  return auth.tokens?.access_token ?? "";
}

function getRefreshToken(auth: CodexAuth): string {
  return auth.tokens?.refresh_token ?? "";
}

function tokenExpiry(auth: CodexAuth): number {
  return Number(auth.tokens?.expires_at ?? auth.tokens?.expiresAt ?? 0);
}

function tokenNeedsRefresh(auth: CodexAuth): boolean {
  const token = getAccessToken(auth);
  if (!token) return true;
  const exp = tokenExpiry(auth);
  if (!exp) return false;
  return exp - Math.floor(Date.now() / 1000) <= REFRESH_SKEW_SECONDS;
}

function writeAuthFile(auth: CodexAuth): void {
  const tmp = `${AUTH_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
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

let tokenRefreshInFlight: Promise<CodexAuth> | undefined;

async function refreshAccessToken(auth: CodexAuth): Promise<CodexAuth> {
  const refreshToken = getRefreshToken(auth);
  if (!refreshToken) {
    // No refresh token — return as-is; caller will get a 401 and surface it.
    return auth;
  }
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    // Refresh failed — return existing auth; the API call will surface the 401.
    return auth;
  }
  const data = (await res.json()) as Record<string, any>;
  const newAccessToken = data?.access_token ?? data?.tokens?.access_token ?? "";
  const newExpiresAt = Number(
    data?.expires_at ?? data?.tokens?.expires_at ?? 0,
  );
  if (!newAccessToken) return auth;

  const next: CodexAuth = {
    ...auth,
    tokens: {
      ...auth.tokens,
      access_token: newAccessToken,
      ...(newExpiresAt
        ? { expires_at: newExpiresAt, expiresAt: newExpiresAt }
        : {}),
    },
    last_refresh: new Date().toISOString(),
  };
  writeAuthFile(next);
  return next;
}

async function loadAuth(): Promise<CodexAuth> {
  const auth = readAuthFile();
  if (!tokenNeedsRefresh(auth)) return auth;
  if (!tokenRefreshInFlight) {
    tokenRefreshInFlight = refreshAccessToken(auth).finally(() => {
      tokenRefreshInFlight = undefined;
    });
  }
  return tokenRefreshInFlight;
}

function readInstallId(): string {
  try {
    if (fs.existsSync(INSTALL_ID_FILE)) {
      return fs.readFileSync(INSTALL_ID_FILE, "utf8").trim();
    }
  } catch {
    /* ok */
  }
  return "";
}

function readModelsCache(): { client_version?: string; models?: any[] } {
  try {
    if (fs.existsSync(MODELS_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(MODELS_CACHE_FILE, "utf8"));
    }
  } catch {
    /* ok */
  }
  return {};
}

// ── Request conversion ────────────────────────────────────────────────────────

/**
 * Converts a chat completion messages array into the Codex backend format:
 *   - system/developer messages become the `instructions` string
 *   - user/assistant/tool messages become `input` list items
 *
 * The Codex backend requires:
 *   - `instructions`: plain text string (from system/developer messages)
 *   - `input`: list of {role, content: [{type:"input_text", text}]} objects
 */
function chatMessagesToCodexBody(
  model: string,
  messages: any[],
  options: Record<string, any> = {},
): Record<string, any> {
  // Extract system/developer messages as `instructions`
  const systemParts: string[] = [];
  const inputMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content ?? [])
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n");
      if (text) systemParts.push(text);
    } else {
      inputMessages.push(convertMessage(msg));
    }
  }

  const body: Record<string, any> = {
    model,
    store: false,
    ...options,
  };

  if (systemParts.length > 0) {
    body.instructions = systemParts.join("\n\n");
  }

  // Codex backend requires input to be a list (not a string)
  body.input = inputMessages;

  return body;
}

function convertMessage(msg: any): any {
  if (msg.role === "tool") {
    return {
      type: "function_call_output",
      call_id: msg.tool_call_id ?? "unknown",
      output:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    };
  }

  const contentParts = buildContentParts(msg.content, msg.role);
  const converted: any = { role: msg.role, content: contentParts };

  if (msg.role === "assistant" && msg.tool_calls?.length) {
    converted.tool_calls = msg.tool_calls;
  }

  return { role: msg.role, content: contentParts };
}

function buildContentParts(content: any, role: string): any[] {
  if (typeof content === "string") {
    return [
      { type: role === "user" ? "input_text" : "output_text", text: content },
    ];
  }
  if (Array.isArray(content)) {
    return content.map((part: any) => {
      if (part.type === "text") {
        return {
          type: role === "user" ? "input_text" : "output_text",
          text: part.text,
        };
      }
      if (part.type === "image_url") {
        return {
          type: "input_image",
          image_url: part.image_url?.url ?? part.image_url,
        };
      }
      return part;
    });
  }
  return [{ type: "input_text", text: String(content ?? "") }];
}

// ── Tool format conversion ───────────────────────────────────────────────────
// The Codex backend expects the Responses API tool shape:
//   { type: "function", name: "...", description: "...", parameters: {...} }
// Continue sends the chat completions tool shape:
//   { type: "function", function: { name: "...", description: "...", parameters: {...} } }
function convertTools(tools: any[] | undefined): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .map((tool) => {
      if (tool.type === "function" && tool.function) {
        // Chat completions → Responses API shape
        return {
          type: "function" as const,
          name: tool.function.name ?? "",
          description: tool.function.description ?? null,
          parameters: tool.function.parameters ?? null,
          strict:
            tool.function.strict !== undefined ? tool.function.strict : null,
        };
      }
      // Already in Responses API shape or unknown — pass through
      return tool;
    })
    .filter((t) => t.name); // drop any entry without a name (would cause 400)
}

// ── API class ─────────────────────────────────────────────────────────────────

export interface ChatGPTCodexConfig {
  provider: "chatgpt-codex";
  model?: string;
  requestOptions?: Record<string, any>;
}

export class ChatGPTCodexApi implements BaseLlmApi {
  private installId: string;

  constructor(private config: ChatGPTCodexConfig) {
    this.installId = readInstallId();
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const auth = await loadAuth();
    const token = getAccessToken(auth);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (this.installId) {
      headers["x-codex-installation-id"] = this.installId;
    }
    return headers;
  }

  // ── chatCompletionStream ──────────────────────────────────────────────────

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers = await this.authHeaders();
    const codexBody = chatMessagesToCodexBody(
      body.model,
      body.messages as any[],
      {
        stream: true,
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : {}),
        ...(body.max_tokens ? { max_output_tokens: body.max_tokens } : {}),
        ...(body.tools ? { tools: convertTools(body.tools as any[]) } : {}),
        ...((body as any).reasoning_effort || (body as any).reasoningEffort
          ? {
              reasoning: {
                effort:
                  (body as any).reasoning_effort ||
                  (body as any).reasoningEffort,
              },
            }
          : {}),
      },
    );

    const res = await fetch(`${CODEX_BASE}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(codexBody),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CodexApiError(
        `ChatGPT Codex: ${res.status} ${res.statusText}`,
        {
          status: res.status,
          url: `${CODEX_BASE}/responses`,
          model: body.model,
          body: text,
        },
      );
    }

    const state = createResponsesStreamState({ model: body.model });

    for await (const event of streamSse(res as any)) {
      // The Codex backend SSE events match the OpenAI Responses API stream format.
      // `obfuscation` fields are transport metadata — skip them.
      if (!event || event.obfuscation) continue;

      const chunk = fromResponsesChunk(state, event as any);
      if (chunk) yield chunk;
    }
  }

  // ── chatCompletionNonStream ───────────────────────────────────────────────
  // The ChatGPT Codex backend requires stream=true on every request.
  // We implement non-streaming by collecting all stream chunks.

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    let fullText = "";
    let responseId = "codex-response";
    let model = body.model;

    // Stream and buffer
    const streamBody = {
      ...body,
      stream: true,
    } as any;

    const state = createResponsesStreamState({ model });

    const headers = await this.authHeaders();
    const codexBody = chatMessagesToCodexBody(
      body.model,
      body.messages as any[],
      {
        stream: true,
        ...(body.temperature !== undefined
          ? { temperature: body.temperature }
          : {}),
        ...(body.max_tokens ? { max_output_tokens: body.max_tokens } : {}),
        ...(body.tools ? { tools: convertTools(body.tools as any[]) } : {}),
        ...((body as any).reasoning_effort || (body as any).reasoningEffort
          ? {
              reasoning: {
                effort:
                  (body as any).reasoning_effort ||
                  (body as any).reasoningEffort,
              },
            }
          : {}),
      },
    );

    const res = await fetch(`${CODEX_BASE}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(codexBody),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ChatGPT Codex API error ${res.status}: ${text}`);
    }

    for await (const event of streamSse(res as any)) {
      if (!event || event.obfuscation) continue;
      if (event.type === "response.created")
        responseId = event.response?.id ?? responseId;
      const chunk = fromResponsesChunk(state, event as any);
      if (chunk?.choices?.[0]?.delta?.content) {
        fullText += chunk.choices[0].delta.content;
      }
    }

    return {
      id: responseId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullText, refusal: null },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  // ── list ──────────────────────────────────────────────────────────────────

  async list(): Promise<Model[]> {
    const cache = readModelsCache();
    const models = cache.models ?? [];
    const clientVersion = cache.client_version ?? "0.140.0";

    // Try the live endpoint; fall back to cache on network error.
    try {
      const auth = await loadAuth();
      const token = getAccessToken(auth);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      if (this.installId) headers["x-codex-installation-id"] = this.installId;

      const res = await fetch(
        `${CODEX_BASE}/models?client_version=${encodeURIComponent(clientVersion)}`,
        { headers },
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        return (data.models ?? []).map((m: any) => ({
          id: m.slug,
          object: "model" as const,
          created: 0,
          owned_by: "chatgpt-codex",
        }));
      }
    } catch {
      /* fall through to cache */
    }

    return models.map((m: any) => ({
      id: m.slug ?? m.id,
      object: "model" as const,
      created: 0,
      owned_by: "chatgpt-codex",
    }));
  }

  // ── Stubs for unused methods ──────────────────────────────────────────────

  async *completionStream(
    _body: CompletionCreateParamsStreaming,
    _signal: AbortSignal,
  ): AsyncGenerator<Completion> {
    throw new Error(
      "ChatGPT Codex backend does not support legacy completions.",
    );
  }

  async completionNonStream(
    _body: CompletionCreateParamsNonStreaming,
    _signal: AbortSignal,
  ): Promise<Completion> {
    throw new Error(
      "ChatGPT Codex backend does not support legacy completions.",
    );
  }

  async *fimStream(
    _body: FimCreateParamsStreaming,
    _signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    throw new Error("ChatGPT Codex backend does not support FIM completions.");
  }

  async embed(_body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse> {
    throw new Error("ChatGPT Codex backend does not support embeddings.");
  }

  async rerank(_body: RerankCreateParams): Promise<CreateRerankResponse> {
    throw new Error("ChatGPT Codex backend does not support reranking.");
  }
}

export default ChatGPTCodexApi;
