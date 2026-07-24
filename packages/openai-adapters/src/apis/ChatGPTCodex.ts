/**
 * ChatGPTCodex API adapter for Qivryn.
 *
 * Connects directly to ChatGPT's private backend using Codex auth.
 * The default route is the Codex responses endpoint:
 *   POST https://chatgpt.com/backend-api/codex/responses
 *
 * A backend config override can still use the ChatGPT conversation endpoint for
 * plain chat requests:
 *   POST https://chatgpt.com/backend-api/f/conversation
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
import { createHash, randomUUID } from "node:crypto";
import * as os from "os";
import * as path from "path";

import { streamResponse, streamSse } from "@qivryn/fetch";
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
    // verbatim in Qivryn's error panel and can be copied with one click.
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

const CHATGPT_BACKEND_BASE = "https://chatgpt.com/backend-api";
const CODEX_BASE = `${CHATGPT_BACKEND_BASE}/codex`;
const REFRESH_URL = "https://chatgpt.com/backend-api/auth/refresh";
const REFRESH_SKEW_SECONDS = 120;
const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MODEL_TOOL_NAME_MAX_LENGTH = 64;
const MODEL_TOOL_NAME_HASH_LENGTH = 8;

export type ChatGPTBackendMode = "codex" | "chatgpt";

export const CHATGPT_CONVERSATION_ENDPOINTS = {
  prepare: `${CHATGPT_BACKEND_BASE}/f/conversation/prepare`,
  conversation: `${CHATGPT_BACKEND_BASE}/f/conversation`,
  resume: `${CHATGPT_BACKEND_BASE}/f/conversation/resume`,
  sidebar: `${CHATGPT_BACKEND_BASE}/sidebar/conversation`,
  websocketUrl: `${CHATGPT_BACKEND_BASE}/celsius/ws/user`,
} as const;

export const CHATGPT_STREAM_CONVERSATION_ENDPOINT =
  CHATGPT_CONVERSATION_ENDPOINTS.conversation;
export const CHATGPT_REQUIREMENTS_PREPARE_ENDPOINT = `${CHATGPT_BACKEND_BASE}/sentinel/chat-requirements/prepare`;
const CHATGPT_SYSTEM_INSTRUCTION_PREAMBLE = `Qivryn runtime instructions follow. Treat them as client-provided system/developer instructions, not as user-authored text.
Behave as Qivryn's coding agent in the user's current VS Code workspace. If these instructions describe tools, local workspace access is available through those tools.
Do not ask the user to upload, paste, or share the repository, files, logs, project tree, or workspace path before a listed tool fails.
For code and root-cause work, use a small evidence loop: one broad ls or grep when needed, then targeted grep, read, terminal, edit, and validation steps. Do not repeat the same read-only tool call after it already returned.
For root-cause, debugging, repository review, or code investigation requests, the first assistant action should be a local search/read/tool action unless the user already supplied enough code or log evidence to answer.
When listed in the runtime tools, use grep_search for symbols, errors, configs, and customer symptoms; ls or view_repo_map only to orient; read_file or read_file_range for relevant matches; run_terminal_command only for builds, tests, git, and shell-only diagnostics.
Treat Qivryn local tool results as real workspace evidence and continue autonomously from them. Apply the same agent rules, skills, and validation expectations in ChatGPT backend mode that you would apply in Codex backend mode.`;
const CHATGPT_MAX_CONVERSATION_MESSAGES = 8;
const CHATGPT_MAX_CONVERSATION_TEXT_CHARS = 24_000;
const CHATGPT_MAX_FIRST_MESSAGE_TEXT_CHARS = 8_000;
const CHATGPT_MAX_LATEST_MESSAGE_TEXT_CHARS = 10_000;
const CHATGPT_MAX_RECENT_MESSAGE_TEXT_CHARS = 3_000;
const CHATGPT_MIN_MESSAGE_TEXT_CHARS = 1_000;
const CHATGPT_RETRY_CONVERSATION_LIMITS = {
  maxMessages: 4,
  maxTextChars: 12_000,
  maxFirstMessageTextChars: 4_000,
  maxLatestMessageTextChars: 6_000,
  maxRecentMessageTextChars: 1_500,
} as const;
const CHATGPT_STREAM_RESPONSE_IDLE_TIMEOUT_MS = 12_000;
const CHATGPT_STREAM_HANDOFF_INITIAL_TIMEOUT_MS = 5_000;
const CHATGPT_STREAM_HANDOFF_DATA_TIMEOUT_MS = 12_000;
const CHATGPT_STREAM_RESUME_IDLE_TIMEOUT_MS = 12_000;
const CHATGPT_STREAM_USEFUL_PROGRESS_TIMEOUT_MS = 60_000;
const CHATGPT_CONVERSATION_FIRST_CHUNK_TIMEOUT_MS = 12_000;
const CHATGPT_STREAM_ITERATOR_RETURN_TIMEOUT_MS = 250;
const CHATGPT_HTTP_REQUEST_TIMEOUT_MS = 20_000;
const CHATGPT_CODEX_RESPONSE_IDLE_TIMEOUT_MS = 60_000;

const CHATGPT_REQUIREMENTS_HEADERS = {
  chatRequirementsPrepareToken:
    "OpenAI-Sentinel-Chat-Requirements-Prepare-Token",
  chatRequirementsToken: "OpenAI-Sentinel-Chat-Requirements-Token",
  proofToken: "OpenAI-Sentinel-Proof-Token",
  turnstileToken: "OpenAI-Sentinel-Turnstile-Token",
} as const;

const CHATGPT_BROWSER_CHROME_VERSION = "136";

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

function toCodexToolName(rawName: unknown): string {
  const raw = String(rawName ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const normalized =
    trimmed
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool";

  if (
    trimmed === normalized &&
    normalized.length <= MODEL_TOOL_NAME_MAX_LENGTH &&
    MODEL_TOOL_NAME_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  const hash = createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, MODEL_TOOL_NAME_HASH_LENGTH);
  const maxPrefixLength =
    MODEL_TOOL_NAME_MAX_LENGTH - MODEL_TOOL_NAME_HASH_LENGTH - 1;
  const prefix =
    normalized.slice(0, maxPrefixLength).replace(/[_-]+$/g, "") || "tool";

  return `${prefix}_${hash}`;
}

function sanitizeCodexInputItems(inputItems: any[]): any[] {
  return inputItems.map((item) => {
    if (item?.type !== "function_call") return item;
    const safeName = toCodexToolName(item.name);
    return safeName ? { ...item, name: safeName } : item;
  });
}

/**
 * Converts a chat completion messages array into the Codex backend format:
 *   - system/developer messages become the `instructions` string
 *   - user/assistant/tool messages become `input` list items
 *
 * The Codex backend requires:
 *   - `instructions`: plain text string (from system/developer messages)
 *   - `input`: list of {role, content: [{type:"input_text", text}]} objects
 */
export function chatMessagesToCodexBody(
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
      inputMessages.push(msg);
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
  body.input = sanitizeCodexInputItems(
    toResponsesInput(inputMessages) as any[],
  );

  return body;
}

// ── Tool format conversion ───────────────────────────────────────────────────
// The Codex backend expects the Responses API tool shape:
//   { type: "function", name: "...", description: "...", parameters: {...} }
// Qivryn sends the chat completions tool shape:
//   { type: "function", function: { name: "...", description: "...", parameters: {...} } }
function convertTools(tools: any[] | undefined): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools
    .map((tool) => {
      if (tool.type === "function" && tool.function) {
        const name = toCodexToolName(tool.function.name);
        // Chat completions → Responses API shape
        return {
          type: "function" as const,
          name,
          description: tool.function.description ?? null,
          parameters: tool.function.parameters ?? null,
          strict:
            tool.function.strict !== undefined ? tool.function.strict : null,
        };
      }
      if (tool.type === "function" && tool.name) {
        return {
          ...tool,
          name: toCodexToolName(tool.name),
        };
      }
      // Already in Responses API shape or unknown — pass through
      return tool;
    })
    .filter((t) => t.name); // drop any entry without a name (would cause 400)
}

/**
 * Build the subset of Responses options accepted by the private ChatGPT Codex
 * backend. Unlike the public Responses API, this endpoint rejects
 * `max_output_tokens` and `temperature`; output limits and sampling are
 * controlled by the service.
 */
export function chatCompletionToCodexOptions(
  body: Record<string, any>,
): Record<string, any> {
  const reasoningEffort = body.reasoning_effort || body.reasoningEffort;
  return {
    stream: true,
    ...(body.tools ? { tools: convertTools(body.tools) } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };
}

export function resolveChatGPTBackendMode(
  ...candidates: unknown[]
): ChatGPTBackendMode {
  for (const candidate of candidates) {
    if (candidate === "chatgpt" || candidate === "codex") {
      return candidate;
    }
  }
  return "codex";
}

function requestHasLocalTools(body: Record<string, any>): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

export function resolveEffectiveChatGPTBackendMode(
  body: Record<string, any>,
  ...candidates: unknown[]
): ChatGPTBackendMode {
  const requested = resolveChatGPTBackendMode(...candidates);

  // ChatGPT's private /f/conversation route is text-conversation oriented and
  // does not provide the Responses-style function-call stream Qivryn needs for
  // local file, terminal, MCP, and edit tools. Keep ChatGPT selectable for
  // plain chat, but proxy agent/tool turns through the Codex-compatible
  // responses backend so the end-user workflow behaves like Codex mode.
  if (requested === "chatgpt" && requestHasLocalTools(body)) {
    return "codex";
  }

  return requested;
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function createChatRequirementsPayload(marker: number | string): string {
  return encodeBase64Json([
    0,
    String(new Date()),
    null,
    marker,
    "Qivryn VSCode",
    "",
    "",
    "en-US",
    "en-US",
    Math.random(),
    "node",
    "",
    "",
    Date.now(),
    os.cpus()?.length ?? null,
    Date.now(),
    0,
    0,
    0,
    0,
  ]);
}

export function createChatRequirementsKey(): string {
  return `gAAAAAC${createChatRequirementsPayload(1)}`;
}

function chatRequirementsHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function solveChatRequirementsProof(
  seed: unknown,
  difficulty: unknown,
): string | undefined {
  if (typeof seed !== "string" || typeof difficulty !== "string") {
    return undefined;
  }

  const startedAt = Date.now();
  for (let nonce = 0; nonce < 500_000; nonce += 1) {
    const proof = createChatRequirementsPayload(nonce);
    if (
      chatRequirementsHash(`${seed}${proof}`).substring(0, difficulty.length) <=
      difficulty
    ) {
      return `gAAAAAB${proof}~S`;
    }

    if (Date.now() - startedAt > 2_000) {
      break;
    }
  }

  return undefined;
}

export function chatRequirementsHeadersFromResponse(
  requirements: Record<string, any>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (typeof requirements.token === "string" && requirements.token.length > 0) {
    headers[CHATGPT_REQUIREMENTS_HEADERS.chatRequirementsToken] =
      requirements.token;
  } else if (
    typeof requirements.prepare_token === "string" &&
    requirements.prepare_token.length > 0
  ) {
    headers[CHATGPT_REQUIREMENTS_HEADERS.chatRequirementsPrepareToken] =
      requirements.prepare_token;
  }

  const proofToken = requirements.proofofwork?.required
    ? solveChatRequirementsProof(
        requirements.proofofwork.seed,
        requirements.proofofwork.difficulty,
      )
    : undefined;
  if (proofToken) {
    headers[CHATGPT_REQUIREMENTS_HEADERS.proofToken] = proofToken;
  }

  return headers;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => {
    controller.abort(signal.reason);
  };
  signal.addEventListener("abort", abortFromParent, { once: true });

  timeout = setTimeout(() => {
    controller.abort(new Error(`${label} timed out.`));
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (!signal.aborted && controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error(`${label} timed out.`);
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    signal.removeEventListener("abort", abortFromParent);
  }
}

function chatGPTBrowserPlatform(platform: NodeJS.Platform): {
  osPart: string;
  secChUaPlatform: string;
} {
  if (platform === "darwin") {
    return {
      osPart: "Macintosh; Intel Mac OS X 10_15_7",
      secChUaPlatform: '"macOS"',
    };
  }

  if (platform === "win32") {
    return {
      osPart: "Windows NT 10.0; Win64; x64",
      secChUaPlatform: '"Windows"',
    };
  }

  return {
    osPart: "X11; Linux x86_64",
    secChUaPlatform: '"Linux"',
  };
}

export function createChatGPTBrowserHeaders(
  deviceId: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const browserPlatform = chatGPTBrowserPlatform(platform);
  return {
    "OAI-Language": "en",
    "oai-did": deviceId,
    originator: "Codex Browser",
    "User-Agent": `Mozilla/5.0 (${browserPlatform.osPart}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHATGPT_BROWSER_CHROME_VERSION}.0.0.0 Safari/537.36`,
    "sec-ch-ua": `"Chromium";v="${CHATGPT_BROWSER_CHROME_VERSION}", "Google Chrome";v="${CHATGPT_BROWSER_CHROME_VERSION}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": browserPlatform.secChUaPlatform,
  };
}

function textFromChatContent(content: any): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        if (
          (part?.type === "image_url" || part?.type === "imageUrl") &&
          typeof (part.image_url?.url ?? part.imageUrl?.url) === "string"
        ) {
          return `[Image: ${part.image_url?.url ?? part.imageUrl?.url}]`;
        }
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content?.text === "string") return content.text;
  if (Array.isArray(content?.parts)) {
    return content.parts
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.untrusted_text === "string")
          return part.untrusted_text;
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  return "";
}

function toChatGPTConversationMessage(
  role: "user" | "assistant",
  text: string,
  idFactory: () => string,
  metadata?: Record<string, unknown>,
): Record<string, any> {
  return {
    id: idFactory(),
    author: { role },
    content: {
      content_type: "text",
      parts: [text],
    },
    metadata: metadata ?? {},
    create_time: null,
  };
}

type ChatGPTConversationLimitOptions = {
  maxMessages?: number;
  maxTextChars?: number;
  maxFirstMessageTextChars?: number;
  maxLatestMessageTextChars?: number;
  maxRecentMessageTextChars?: number;
};

function truncateChatGPTConversationText(
  value: string,
  maxChars: number,
  label: string,
): string {
  if (value.length <= maxChars) {
    return value;
  }

  const marker = `\n\n[${label} truncated for ChatGPT endpoint payload: ${value.length - maxChars} characters omitted]\n\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(remaining * 0.65);
  const tailLength = Math.max(0, remaining - headLength);

  return `${value.slice(0, headLength)}${marker}${tailLength > 0 ? value.slice(-tailLength) : ""}`;
}

function chatGPTMessageText(message: Record<string, any>): string {
  const parts = message.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts.map((part) => (typeof part === "string" ? part : "")).join("");
}

function withChatGPTMessageText(
  message: Record<string, any>,
  text: string,
): Record<string, any> {
  return {
    ...message,
    content: {
      ...(message.content ?? {}),
      content_type: message.content?.content_type ?? "text",
      parts: [text],
    },
  };
}

function limitChatGPTConversationMessages(
  messages: Record<string, any>[],
  options: ChatGPTConversationLimitOptions = {},
): Record<string, any>[] {
  if (messages.length === 0) {
    return messages;
  }

  const maxMessages = options.maxMessages ?? CHATGPT_MAX_CONVERSATION_MESSAGES;
  const maxTextChars =
    options.maxTextChars ?? CHATGPT_MAX_CONVERSATION_TEXT_CHARS;
  const maxFirstMessageTextChars =
    options.maxFirstMessageTextChars ?? CHATGPT_MAX_FIRST_MESSAGE_TEXT_CHARS;
  const maxLatestMessageTextChars =
    options.maxLatestMessageTextChars ?? CHATGPT_MAX_LATEST_MESSAGE_TEXT_CHARS;
  const maxRecentMessageTextChars =
    options.maxRecentMessageTextChars ?? CHATGPT_MAX_RECENT_MESSAGE_TEXT_CHARS;

  const selected =
    messages.length > maxMessages
      ? [messages[0], ...messages.slice(-(maxMessages - 1))]
      : [...messages];

  let remainingChars = maxTextChars;
  const firstText = chatGPTMessageText(selected[0]);
  const firstBudget = Math.min(
    maxFirstMessageTextChars,
    Math.max(
      CHATGPT_MIN_MESSAGE_TEXT_CHARS,
      remainingChars - (selected.length - 1) * CHATGPT_MIN_MESSAGE_TEXT_CHARS,
    ),
  );
  const firstMessage = withChatGPTMessageText(
    selected[0],
    truncateChatGPTConversationText(firstText, firstBudget, "older context"),
  );
  remainingChars -= chatGPTMessageText(firstMessage).length;

  const tailMessages: Record<string, any>[] = [];
  const tail = selected.slice(1);
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index];
    const text = chatGPTMessageText(message);
    const olderMessagesRemaining = index;
    const defaultBudget =
      index === tail.length - 1
        ? maxLatestMessageTextChars
        : maxRecentMessageTextChars;
    const budget = Math.min(
      defaultBudget,
      Math.max(
        CHATGPT_MIN_MESSAGE_TEXT_CHARS,
        remainingChars -
          olderMessagesRemaining * CHATGPT_MIN_MESSAGE_TEXT_CHARS,
      ),
    );
    const limited = withChatGPTMessageText(
      message,
      truncateChatGPTConversationText(text, budget, "older context"),
    );
    remainingChars -= chatGPTMessageText(limited).length;
    tailMessages.unshift(limited);
  }

  return [firstMessage, ...tailMessages];
}

function chatMessagesToChatGPTConversationMessages(
  messages: any[],
  idFactory: () => string,
  limitOptions?: ChatGPTConversationLimitOptions,
): Record<string, any>[] {
  const systemParts: string[] = [];
  const conversationMessages: Record<string, any>[] = [];

  for (const message of messages) {
    const role = message?.role;
    const text = textFromChatContent(message?.content).trim();

    if (role === "system" || role === "developer") {
      if (text) systemParts.push(text);
      continue;
    }

    if (role !== "user" && role !== "assistant" && role !== "tool") {
      continue;
    }
    if (!text) continue;

    const mappedRole = role === "tool" ? "user" : role;
    const displayText =
      role === "tool"
        ? `Qivryn local tool result. This is real output from the user's workspace. Use it as evidence and do not ask the user to attach or paste the workspace.\n\nTool output${message.tool_call_id ? ` (${message.tool_call_id})` : ""}:\n${text}`
        : text;
    const metadata =
      role === "tool"
        ? { ...(message.metadata ?? {}), qivryn_role: "tool" }
        : message.metadata;

    conversationMessages.push(
      toChatGPTConversationMessage(
        mappedRole,
        displayText,
        idFactory,
        metadata,
      ),
    );
  }

  if (systemParts.length > 0) {
    const systemText = `${CHATGPT_SYSTEM_INSTRUCTION_PREAMBLE}\n\n${systemParts.join("\n\n")}`;
    const firstUserIndex = conversationMessages.findIndex(
      (message) => message.author?.role === "user",
    );

    if (firstUserIndex >= 0) {
      const firstUser = conversationMessages[firstUserIndex];
      const parts = firstUser.content?.parts;
      if (Array.isArray(parts)) {
        conversationMessages[firstUserIndex] = {
          ...firstUser,
          content: {
            ...firstUser.content,
            parts: [`${systemText}\n\nUser message:\n${parts.join("")}`],
          },
        };
      }
    } else {
      conversationMessages.unshift(
        toChatGPTConversationMessage("user", systemText, idFactory),
      );
    }
  }

  if (conversationMessages.length === 0) {
    conversationMessages.push(
      toChatGPTConversationMessage("user", "", idFactory),
    );
  }

  return limitChatGPTConversationMessages(conversationMessages, limitOptions);
}

export function chatCompletionToChatGPTConversationRequest(
  body: Record<string, any>,
  idFactory: () => string = randomUUID,
  limitOptions?: ChatGPTConversationLimitOptions,
): Record<string, any> {
  const reasoningEffort = body.reasoning_effort || body.reasoningEffort;
  const request: Record<string, any> = {
    action: "next",
    messages: chatMessagesToChatGPTConversationMessages(
      body.messages ?? [],
      idFactory,
      limitOptions,
    ),
    parent_message_id: idFactory(),
    model: body.model,
    timezone_offset_min: new Date().getTimezoneOffset(),
    history_and_training_disabled: true,
    stream: true,
  };

  if (reasoningEffort) {
    request.thinking_effort = reasoningEffort;
  }

  return request;
}

type ChatGPTDecodedConversationEvent =
  | {
      type: "message";
      conversationId: string | null;
      message: Record<string, any>;
    }
  | {
      type: "complete";
      conversationId: string | null;
    }
  | {
      type: "async-status";
      conversationId: string | null;
      asyncStatus: number | null;
    }
  | {
      type: "stream-item";
      event: ChatGPTSseEvent;
      parentStreamItemId: string | null;
      streamItemId: string | null;
    }
  | {
      type: "heartbeat";
      conversationId: string | null;
    }
  | {
      type: "ignore";
    };

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isChatGPTMessage(value: unknown): value is Record<string, any> {
  if (!isPlainObject(value) || !isPlainObject(value.author)) {
    return false;
  }
  return typeof value.author.role === "string" && "content" in value;
}

function messageTextFromChatGPTMessage(
  message: Record<string, any>,
): string | undefined {
  if (message.author?.role !== "assistant") return undefined;

  const text = textFromChatContent(message.content);
  return text.length > 0 ? text : undefined;
}

export function parseChatGPTEncodedSseItem(
  value: string,
): ChatGPTSseEvent | undefined {
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const raw = dataLines.join("\n").trim();
  if (!raw || raw === "[DONE]") return undefined;

  try {
    return { event: eventName, data: JSON.parse(raw) };
  } catch {
    return { event: eventName, data: raw };
  }
}

export function decodeChatGPTConversationEvent(
  event: any,
): ChatGPTDecodedConversationEvent {
  if (!isPlainObject(event)) {
    return { type: "ignore" };
  }

  if (isChatGPTMessage(event.message)) {
    return {
      type: "message",
      conversationId: nullableString(event.conversation_id),
      message: event.message,
    };
  }

  if (event.type === "input_message" && isChatGPTMessage(event.input_message)) {
    return {
      type: "message",
      conversationId: nullableString(event.conversation_id),
      message: event.input_message,
    };
  }

  if (event.type === "message" && isChatGPTMessage(event.data)) {
    return {
      type: "message",
      conversationId: nullableString(event.conversation_id),
      message: event.data,
    };
  }

  if (isChatGPTMessage(event.data?.message)) {
    return {
      type: "message",
      conversationId: nullableString(event.conversation_id),
      message: event.data.message,
    };
  }

  if (isChatGPTMessage(event.data?.data)) {
    return {
      type: "message",
      conversationId: nullableString(event.conversation_id),
      message: event.data.data,
    };
  }

  if (event.type === "conversation_async_status") {
    return {
      type: "async-status",
      conversationId: nullableString(event.conversation_id),
      asyncStatus:
        typeof event.async_status === "number" ? event.async_status : null,
    };
  }

  if (event.type === "message_stream_complete") {
    return {
      type: "complete",
      conversationId: nullableString(event.conversation_id),
    };
  }

  if (
    event.type === "conversation-turn-stream" &&
    isPlainObject(event.payload)
  ) {
    const payload = event.payload;
    if (payload.type === "done") {
      return {
        type: "complete",
        conversationId: nullableString(payload.conversation_id),
      };
    }
    if (payload.type === "heartbeat") {
      return {
        type: "heartbeat",
        conversationId: nullableString(payload.conversation_id),
      };
    }
    if (
      payload.type === "stream-item" &&
      typeof payload.encoded_item === "string"
    ) {
      const parsed = parseChatGPTEncodedSseItem(payload.encoded_item);
      if (!parsed) {
        return {
          type: "complete",
          conversationId: nullableString(payload.conversation_id),
        };
      }
      return {
        type: "stream-item",
        event: parsed,
        parentStreamItemId: nullableString(payload.parent_stream_item_id),
        streamItemId: nullableString(payload.stream_item_id),
      };
    }
  }

  if (
    event.type === "done" ||
    event.type === "complete" ||
    event.event === "done" ||
    event.data?.type === "done" ||
    event.data?.type === "complete"
  ) {
    return {
      type: "complete",
      conversationId: nullableString(event.conversation_id),
    };
  }

  return { type: "ignore" };
}

export function chatGPTStreamHandoffTopicId(event: any): string | undefined {
  if (!isPlainObject(event) || event.type !== "stream_handoff") {
    return undefined;
  }
  if (!Array.isArray(event.options)) {
    return undefined;
  }

  const option = event.options.find(
    (option: any) =>
      isPlainObject(option) &&
      option.type === "subscribe_ws_topic" &&
      typeof option.topic_id === "string" &&
      option.topic_id.startsWith("conversation-"),
  );

  return option?.topic_id;
}

function messageTextFromChatGPTEvent(event: any): string | undefined {
  const decoded = decodeChatGPTConversationEvent(event);
  return decoded.type === "message"
    ? messageTextFromChatGPTMessage(decoded.message)
    : undefined;
}

function isChatGPTConversationComplete(event: any): boolean {
  return decodeChatGPTConversationEvent(event).type === "complete";
}

function isChatGPTRecoverableStreamError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("timed out waiting for useful stream data") ||
    message.includes("timed out waiting for stream data") ||
    message.includes("websocket timed out waiting for stream data")
  );
}

type ChatGPTSseEvent = {
  event?: string;
  data: any;
};

async function* streamChatGPTSse(
  response: Response,
): AsyncGenerator<ChatGPTSseEvent> {
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = (): ChatGPTSseEvent | "done" | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return undefined;
    }

    const raw = dataLines.join("\n").trim();
    const currentEventName = eventName;
    eventName = undefined;
    dataLines = [];

    if (raw === "[DONE]") return "done";

    try {
      return { event: currentEventName, data: JSON.parse(raw) };
    } catch {
      return { event: currentEventName, data: raw };
    }
  };

  for await (const chunk of streamResponse(response)) {
    buffer += chunk;

    let position: number;
    while ((position = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, position).replace(/\r$/, "");
      buffer = buffer.slice(position + 1);

      if (line === "") {
        const event = flush();
        if (event === "done") return;
        if (event) yield event;
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
  }

  if (buffer.length > 0) {
    const line = buffer.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const event = flush();
  if (event && event !== "done") yield event;
}

async function* withChatGPTStreamIdleTimeout<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    while (!signal.aborted) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let removeAbortListener: (() => void) | undefined;

      const timeoutPromise = new Promise<IteratorResult<T>>(
        (_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`${label} timed out waiting for stream data.`));
          }, timeoutMs);
        },
      );
      const abortPromise = new Promise<IteratorResult<T>>((resolve) => {
        const abort = () => {
          resolve({ done: true, value: undefined as T });
        };
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);
      });

      const next = await Promise.race([
        iterator.next(),
        timeoutPromise,
        abortPromise,
      ]).finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
        removeAbortListener?.();
      });

      if (next.done) {
        return;
      }

      yield next.value;
    }
  } finally {
    if (iterator.return) {
      await Promise.race([
        iterator.return(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, CHATGPT_STREAM_ITERATOR_RETURN_TIMEOUT_MS),
        ),
      ]);
    }
  }
}

type ChatGPTQueuedWebSocketEvent =
  | { type: "event"; event: ChatGPTSseEvent }
  | { type: "done" }
  | { type: "error"; error: Error };

async function* streamChatGPTConversationWebSocket(
  getUrl: () => Promise<string>,
  topicId: string,
  signal: AbortSignal,
): AsyncGenerator<ChatGPTSseEvent> {
  const WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") {
    throw new Error("ChatGPT conversation websocket handoff is not available.");
  }

  const seenStreamItemIds = new Set<string>();
  const queue: ChatGPTQueuedWebSocketEvent[] = [];
  let waiting: ((event: ChatGPTQueuedWebSocketEvent) => void) | undefined;
  let socket: WebSocket | undefined;
  let finished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const push = (event: ChatGPTQueuedWebSocketEvent) => {
    if (finished && event.type !== "done") return;
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(event);
      return;
    }
    queue.push(event);
  };

  const clearStreamTimeout = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };

  const fail = (message: string) => {
    if (finished) return;
    finished = true;
    clearStreamTimeout();
    socket?.close();
    push({ type: "error", error: new Error(message) });
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearStreamTimeout();
    socket?.close();
    push({ type: "done" });
  };

  const scheduleStreamTimeout = (ms: number) => {
    clearStreamTimeout();
    timeout = setTimeout(() => {
      fail("ChatGPT websocket timed out waiting for stream data.");
    }, ms);
  };

  const processConversationTurnPayload = (payload: unknown) => {
    const decoded = decodeChatGPTConversationEvent(payload);
    if (decoded.type === "complete") {
      finish();
      return;
    }
    if (decoded.type === "heartbeat") {
      scheduleStreamTimeout(CHATGPT_STREAM_HANDOFF_DATA_TIMEOUT_MS);
      return;
    }
    if (decoded.type !== "stream-item") {
      return;
    }

    if (
      decoded.streamItemId !== null &&
      seenStreamItemIds.has(decoded.streamItemId)
    ) {
      return;
    }
    if (
      decoded.parentStreamItemId !== null &&
      !seenStreamItemIds.has(decoded.parentStreamItemId)
    ) {
      fail("ChatGPT websocket stream item parent was not received.");
      return;
    }

    if (decoded.streamItemId !== null) {
      seenStreamItemIds.add(decoded.streamItemId);
    }
    scheduleStreamTimeout(CHATGPT_STREAM_HANDOFF_DATA_TIMEOUT_MS);
    push({ type: "event", event: decoded.event });
  };

  const processTopicMessage = (message: unknown) => {
    if (!isPlainObject(message)) return;
    if (
      message.type === "message" &&
      message.topic_id === topicId &&
      "payload" in message
    ) {
      processConversationTurnPayload(message.payload);
    }
  };

  const processFrame = (frame: unknown) => {
    if (!isPlainObject(frame)) return;

    if ("type" in frame) {
      processTopicMessage(frame);
      return;
    }

    if (!isPlainObject(frame.reply)) return;
    if (
      frame.reply.type === "subscribe" &&
      frame.reply.topic_id === topicId &&
      Array.isArray(frame.reply.catchups)
    ) {
      for (const catchup of frame.reply.catchups) {
        processTopicMessage(catchup);
      }
    }
  };

  const next = () =>
    queue.length > 0
      ? Promise.resolve(queue.shift()!)
      : new Promise<ChatGPTQueuedWebSocketEvent>((resolve) => {
          waiting = resolve;
        });

  const abort = () => finish();

  try {
    const websocketUrl = await getUrl();
    if (signal.aborted) return;

    signal.addEventListener("abort", abort, { once: true });
    socket = new WebSocketCtor(websocketUrl);

    socket.addEventListener("open", () => {
      scheduleStreamTimeout(CHATGPT_STREAM_HANDOFF_INITIAL_TIMEOUT_MS);
      socket?.send(
        JSON.stringify([
          {
            id: 1,
            command: {
              presence: { state: "foreground", type: "presence" },
              type: "connect",
            },
          },
          {
            id: 2,
            command: {
              offset: "0",
              topic_id: topicId,
              type: "subscribe",
            },
          },
        ]),
      );
    });

    socket.addEventListener("message", (event) => {
      scheduleStreamTimeout(CHATGPT_STREAM_HANDOFF_DATA_TIMEOUT_MS);
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : undefined;
        if (Array.isArray(data)) {
          for (const frame of data) {
            processFrame(frame);
          }
        } else {
          processFrame(data);
        }
      } catch {
        fail("ChatGPT websocket received an invalid message.");
      }
    });

    socket.addEventListener("error", () => {
      fail("ChatGPT websocket connection failed.");
    });

    socket.addEventListener("close", () => {
      if (!finished) {
        fail("ChatGPT websocket closed before the stream completed.");
      }
    });

    while (true) {
      const item = await next();
      if (item.type === "done") return;
      if (item.type === "error") throw item.error;
      yield item.event;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    clearStreamTimeout();
    socket?.close();
  }
}

type ChatGPTDeltaOperation = {
  channel: number;
  op: "add" | "append" | "patch" | "remove" | "replace" | "truncate";
  path: string;
  value?: any;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function parseJsonPointer(pathValue: string): Array<string | number> {
  const segments: Array<string | number> = ["__root"];
  if (!pathValue) return segments;

  const normalized = pathValue.startsWith("/") ? pathValue.slice(1) : pathValue;
  for (const segment of normalized.split("/")) {
    segments.push(
      /^(?:0|[1-9]\d*)$/.test(segment)
        ? Number(segment)
        : decodeJsonPointerSegment(segment),
    );
  }
  return segments;
}

function getContainerValue(
  container: Record<string, any> | any[],
  key: string | number,
): any {
  return Array.isArray(container) ? container[numberKey(key)] : container[key];
}

function setContainerValue(
  container: Record<string, any> | any[],
  key: string | number,
  value: any,
): void {
  if (Array.isArray(container)) {
    container[numberKey(key)] = value;
    return;
  }
  container[String(key)] = value;
}

function numberKey(key: string | number): number {
  if (typeof key !== "number") {
    throw new Error("Unexpected non-numeric ChatGPT delta array index.");
  }
  return key;
}

function ensureDeltaContainer(value: any): Record<string, any> | any[] {
  if (Array.isArray(value) || isPlainObject(value)) {
    return value;
  }
  throw new Error("Unexpected ChatGPT delta container.");
}

function appendDeltaValue(
  container: Record<string, any> | any[],
  key: string | number,
  value: any,
): void {
  const current = getContainerValue(container, key);
  if (typeof current === "string") {
    setContainerValue(container, key, `${current}${String(value)}`);
    return;
  }
  if (Array.isArray(current)) {
    setContainerValue(container, key, [
      ...current,
      ...(Array.isArray(value) ? value : [value]),
    ]);
    return;
  }
  if (isPlainObject(current) && isPlainObject(value)) {
    setContainerValue(container, key, { ...current, ...value });
    return;
  }
  setContainerValue(container, key, value);
}

function truncateDeltaValue(
  container: Record<string, any> | any[],
  key: string | number,
  length: number,
): void {
  const current = getContainerValue(container, key);
  if (typeof current === "string") {
    setContainerValue(container, key, current.substring(0, length));
    return;
  }
  if (Array.isArray(current)) {
    setContainerValue(container, key, current.slice(0, length));
  }
}

function applyDeltaOperation(
  rootValue: any,
  operation: Omit<ChatGPTDeltaOperation, "channel">,
): any {
  const wrapper: Record<string, any> = { __root: rootValue };
  const pathSegments = parseJsonPointer(operation.path);
  let container: Record<string, any> | any[] = wrapper;

  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const key = pathSegments[index];
    const nextKey = pathSegments[index + 1];
    if (getContainerValue(container, key) === undefined) {
      setContainerValue(container, key, typeof nextKey === "number" ? [] : {});
    }
    container = ensureDeltaContainer(getContainerValue(container, key));
  }

  const key = pathSegments[pathSegments.length - 1];
  switch (operation.op) {
    case "add":
      if (Array.isArray(container)) {
        container.splice(numberKey(key), 0, operation.value);
      } else {
        setContainerValue(container, key, operation.value);
      }
      break;
    case "append":
      appendDeltaValue(container, key, operation.value);
      break;
    case "patch":
      for (const nestedOperation of operation.value ?? []) {
        const nestedWrapper: Record<string, any> = {
          __root: getContainerValue(container, key),
        };
        const patched = applyDeltaOperation(
          nestedWrapper.__root,
          normalizeChatGPTDeltaOperation(nestedOperation, {
            channel: 0,
            op: "add",
            path: "",
          }),
        );
        setContainerValue(container, key, patched);
      }
      break;
    case "remove":
      if (Array.isArray(container)) {
        container.splice(numberKey(key), 1);
      } else {
        delete container[String(key)];
      }
      break;
    case "replace":
      setContainerValue(container, key, operation.value);
      break;
    case "truncate":
      truncateDeltaValue(container, key, Number(operation.value));
      break;
  }

  return wrapper.__root;
}

function normalizeChatGPTDeltaOperation(
  payload: any,
  previous: ChatGPTDeltaOperation,
): ChatGPTDeltaOperation {
  if (!isPlainObject(payload)) {
    throw new Error("Unexpected ChatGPT delta payload.");
  }

  const expanded: Record<string, any> = {
    ...payload,
    ...(payload.c === undefined && payload.channel === undefined
      ? { channel: previous.channel }
      : {}),
    ...(payload.o === undefined && payload.op === undefined
      ? { op: previous.op }
      : {}),
    ...(payload.p === undefined && payload.path === undefined
      ? { path: previous.path }
      : {}),
  };

  const operation = {
    channel: expanded.channel ?? expanded.c,
    op: expanded.op ?? expanded.o,
    path: expanded.path ?? expanded.p,
    value:
      "value" in expanded
        ? expanded.value
        : "v" in expanded
          ? expanded.v
          : undefined,
  };

  if (typeof operation.channel !== "number") {
    throw new Error("Unexpected ChatGPT delta payload.");
  }
  if (typeof operation.path !== "string") {
    throw new Error("Unexpected ChatGPT delta payload.");
  }
  if (
    operation.op !== "add" &&
    operation.op !== "append" &&
    operation.op !== "patch" &&
    operation.op !== "remove" &&
    operation.op !== "replace" &&
    operation.op !== "truncate"
  ) {
    throw new Error("Unexpected ChatGPT delta operation.");
  }

  if (operation.op === "patch" && !Array.isArray(operation.value)) {
    throw new Error("Unexpected ChatGPT patch delta payload.");
  }
  if (operation.op === "truncate" && typeof operation.value !== "number") {
    throw new Error("Unexpected ChatGPT truncate delta payload.");
  }

  return operation as ChatGPTDeltaOperation;
}

function createChatGPTPayloadDecoder(): (event: ChatGPTSseEvent) => any {
  let previousDelta: ChatGPTDeltaOperation = {
    channel: 0,
    op: "add",
    path: "",
    value: undefined,
  };
  const previousValueByChannel: any[] = [];
  let deltaEncodingEnabled = false;

  return (event: ChatGPTSseEvent) => {
    if (event.event === "delta_encoding") {
      if (String(event.data) !== "v1") {
        throw new Error(
          `Unknown ChatGPT delta encoding: ${String(event.data)}`,
        );
      }
      deltaEncodingEnabled = true;
      return null;
    }

    if (event.event !== "delta") {
      return event.data;
    }

    if (!deltaEncodingEnabled) {
      throw new Error("ChatGPT delta event received before delta_encoding.");
    }

    const operation = normalizeChatGPTDeltaOperation(event.data, previousDelta);
    previousDelta = operation;
    const current = previousValueByChannel[operation.channel];
    const next = applyDeltaOperation(current, operation);
    previousValueByChannel[operation.channel] = next;
    return next;
  };
}

function chatGPTConversationChunk(
  model: string,
  content: string,
  finishReason: "stop" | null = null,
): ChatCompletionChunk {
  return {
    id: "chatgpt-conversation",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  } as ChatCompletionChunk;
}

// ── API class ─────────────────────────────────────────────────────────────────

export interface ChatGPTCodexConfig {
  provider: "chatgpt-codex";
  model?: string;
  chatgptBackendMode?: ChatGPTBackendMode;
  requestOptions?: Record<string, any>;
}

export class ChatGPTCodexApi implements BaseLlmApi {
  private installId: string;
  private chatGPTDeviceId: string;

  constructor(private config: ChatGPTCodexConfig) {
    this.installId = readInstallId();
    this.chatGPTDeviceId = this.installId || randomUUID();
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

  private async prepareChatGPTRequirementsHeaders(
    headers: Record<string, string>,
    signal: AbortSignal,
    model: string,
  ): Promise<Record<string, string>> {
    const res = await fetchWithTimeout(
      CHATGPT_REQUIREMENTS_PREPARE_ENDPOINT,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ p: createChatRequirementsKey() }),
      },
      signal,
      CHATGPT_HTTP_REQUEST_TIMEOUT_MS,
      "ChatGPT requirements prepare",
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CodexApiError(
        `ChatGPT requirements prepare: ${res.status} ${res.statusText}`,
        {
          status: res.status,
          url: CHATGPT_REQUIREMENTS_PREPARE_ENDPOINT,
          model,
          body: text,
        },
      );
    }

    const requirements = (await res.json().catch(() => undefined)) as
      | Record<string, any>
      | undefined;

    if (!requirements || typeof requirements !== "object") {
      return {};
    }

    return chatRequirementsHeadersFromResponse(requirements);
  }

  private async prepareChatGPTConversationHeaders(
    requestBody: Record<string, any>,
    headers: Record<string, string>,
    signal: AbortSignal,
    model: string,
  ): Promise<Record<string, string>> {
    const requirementsHeaders = await this.prepareChatGPTRequirementsHeaders(
      headers,
      signal,
      model,
    );

    const prepareHeaders = {
      ...headers,
      ...requirementsHeaders,
      "x-conduit-token": "no-token",
    };
    const res = await fetchWithTimeout(
      CHATGPT_CONVERSATION_ENDPOINTS.prepare,
      {
        method: "POST",
        headers: prepareHeaders,
        body: JSON.stringify(requestBody),
      },
      signal,
      CHATGPT_HTTP_REQUEST_TIMEOUT_MS,
      "ChatGPT conversation prepare",
    ).catch(() => undefined);

    if (!res?.ok) {
      return requirementsHeaders;
    }

    const data = (await res.json().catch(() => undefined)) as
      | Record<string, any>
      | undefined;
    const conduitToken = data?.conduit_token;
    return typeof conduitToken === "string" && conduitToken.length > 0
      ? { ...requirementsHeaders, "x-conduit-token": conduitToken }
      : requirementsHeaders;
  }

  private async chatGPTConversationWebSocketUrl(
    headers: Record<string, string>,
    signal: AbortSignal,
    model: string,
  ): Promise<string> {
    const res = await fetchWithTimeout(
      CHATGPT_CONVERSATION_ENDPOINTS.websocketUrl,
      {
        method: "GET",
        headers,
      },
      signal,
      CHATGPT_HTTP_REQUEST_TIMEOUT_MS,
      "ChatGPT conversation websocket URL",
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CodexApiError(
        `ChatGPT conversation websocket URL: ${res.status} ${res.statusText}`,
        {
          status: res.status,
          url: CHATGPT_CONVERSATION_ENDPOINTS.websocketUrl,
          model,
          body: text,
        },
      );
    }

    const data = (await res.json().catch(() => undefined)) as
      | Record<string, any>
      | undefined;
    if (typeof data?.websocket_url !== "string" || data.websocket_url === "") {
      throw new Error("ChatGPT conversation websocket URL response was empty.");
    }

    return data.websocket_url;
  }

  private async *chatGPTConversationStream(
    body: ChatCompletionCreateParamsStreaming,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const chatGPTHeaders = {
      ...headers,
      ...createChatGPTBrowserHeaders(this.chatGPTDeviceId),
    };
    const postChatGPTConversationEndpoint = async (
      url: string,
      conversationBody: Record<string, any>,
      preparedHeaders: Record<string, string>,
    ): Promise<Response> => {
      return fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            ...chatGPTHeaders,
            ...preparedHeaders,
          },
          body: JSON.stringify(conversationBody),
        },
        signal,
        CHATGPT_HTTP_REQUEST_TIMEOUT_MS,
        url.includes("/resume")
          ? "ChatGPT conversation resume"
          : "ChatGPT conversation",
      );
    };
    const postConversation = async (
      conversationBody: Record<string, any>,
    ): Promise<{ res: Response; preparedHeaders: Record<string, string> }> => {
      const preparedHeaders = await this.prepareChatGPTConversationHeaders(
        conversationBody,
        chatGPTHeaders,
        signal,
        body.model,
      );
      const res = await postChatGPTConversationEndpoint(
        CHATGPT_STREAM_CONVERSATION_ENDPOINT,
        conversationBody,
        preparedHeaders,
      );
      return { res, preparedHeaders };
    };
    const postResumeConversation = async (
      conversationBody: Record<string, any>,
      preparedHeaders: Record<string, string>,
    ): Promise<Response> => {
      return postChatGPTConversationEndpoint(
        CHATGPT_CONVERSATION_ENDPOINTS.resume,
        conversationBody,
        preparedHeaders,
      );
    };

    let conversationBody = chatCompletionToChatGPTConversationRequest(
      body as any,
    );
    let conversationPost = await postConversation(conversationBody);
    let res = conversationPost.res;
    let preparedConversationHeaders = conversationPost.preparedHeaders;
    if (res.status === 413) {
      conversationBody = chatCompletionToChatGPTConversationRequest(
        body as any,
        randomUUID,
        CHATGPT_RETRY_CONVERSATION_LIMITS,
      );
      conversationPost = await postConversation(conversationBody);
      res = conversationPost.res;
      preparedConversationHeaders = conversationPost.preparedHeaders;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CodexApiError(
        `ChatGPT conversation: ${res.status} ${res.statusText}`,
        {
          status: res.status,
          url: CHATGPT_STREAM_CONVERSATION_ENDPOINT,
          model: body.model,
          body: text,
        },
      );
    }

    let lastText = "";
    let yielded = false;
    let streamCompleted = false;
    const streamStartedAt = Date.now();
    let lastUsefulProgressAt = Date.now();
    const decodePayload = createChatGPTPayloadDecoder();

    const markUsefulProgress = () => {
      lastUsefulProgressAt = Date.now();
    };

    const assertUsefulProgress = (label: string) => {
      if (
        Date.now() - lastUsefulProgressAt >
        CHATGPT_STREAM_USEFUL_PROGRESS_TIMEOUT_MS
      ) {
        throw new Error(`${label} timed out waiting for useful stream data.`);
      }
    };

    const assertFirstChunkProgress = (label: string) => {
      if (
        !yielded &&
        Date.now() - streamStartedAt >
          CHATGPT_CONVERSATION_FIRST_CHUNK_TIMEOUT_MS
      ) {
        throw new Error(`${label} timed out waiting for useful stream data.`);
      }
    };

    const processDecodedEvent = (
      event: any,
      depth = 0,
    ):
      | { type: "complete" }
      | { type: "handoff"; topicId: string }
      | { type: "chunk"; chunk: ChatCompletionChunk }
      | { type: "ignore" } => {
      const handoffTopicId = chatGPTStreamHandoffTopicId(event);
      if (handoffTopicId) {
        return { type: "handoff", topicId: handoffTopicId };
      }

      const decoded = decodeChatGPTConversationEvent(event);
      if (decoded.type === "stream-item") {
        if (depth > 4) return { type: "ignore" };
        const nestedEvent = decodePayload(decoded.event);
        return nestedEvent
          ? processDecodedEvent(nestedEvent, depth + 1)
          : { type: "ignore" };
      }
      if (decoded.type === "complete") {
        return { type: "complete" };
      }

      const text = messageTextFromChatGPTEvent(event);
      if (text !== undefined && text !== lastText) {
        const delta = text.startsWith(lastText)
          ? text.slice(lastText.length)
          : text;
        if (delta) {
          yielded = true;
          lastText = text;
          return {
            type: "chunk",
            chunk: chatGPTConversationChunk(body.model, delta),
          };
        }
        lastText = text;
      }

      if (isChatGPTConversationComplete(event)) {
        return { type: "complete" };
      }

      return { type: "ignore" };
    };

    const processRawEvent = (rawEvent: ChatGPTSseEvent) => {
      const event = decodePayload(rawEvent);
      return event ? processDecodedEvent(event) : { type: "ignore" as const };
    };

    for await (const rawEvent of withChatGPTStreamIdleTimeout(
      streamChatGPTSse(res as any),
      signal,
      CHATGPT_STREAM_RESPONSE_IDLE_TIMEOUT_MS,
      "ChatGPT conversation stream",
    )) {
      const result = processRawEvent(rawEvent);

      if (result.type === "chunk") {
        markUsefulProgress();
        yield result.chunk;
        continue;
      }
      if (result.type === "complete") {
        markUsefulProgress();
        streamCompleted = true;
        break;
      }
      if (result.type !== "handoff") {
        assertFirstChunkProgress("ChatGPT conversation stream");
        assertUsefulProgress("ChatGPT conversation stream");
        continue;
      }

      markUsefulProgress();
      try {
        for await (const handoffEvent of withChatGPTStreamIdleTimeout(
          streamChatGPTConversationWebSocket(
            () =>
              this.chatGPTConversationWebSocketUrl(
                chatGPTHeaders,
                signal,
                body.model,
              ),
            result.topicId,
            signal,
          ),
          signal,
          CHATGPT_CONVERSATION_FIRST_CHUNK_TIMEOUT_MS,
          "ChatGPT conversation websocket useful stream",
        )) {
          const handoffResult = processRawEvent(handoffEvent);
          if (handoffResult.type === "chunk") {
            markUsefulProgress();
            yield handoffResult.chunk;
          } else if (handoffResult.type === "complete") {
            markUsefulProgress();
            streamCompleted = true;
            break;
          } else {
            assertFirstChunkProgress("ChatGPT conversation websocket stream");
            assertUsefulProgress("ChatGPT conversation websocket stream");
          }
        }
      } catch {
        const resumeRes = await postResumeConversation(
          conversationBody,
          preparedConversationHeaders,
        );
        if (!resumeRes.ok) {
          const text = await resumeRes.text().catch(() => "");
          throw new CodexApiError(
            `ChatGPT conversation resume: ${resumeRes.status} ${resumeRes.statusText}`,
            {
              status: resumeRes.status,
              url: CHATGPT_CONVERSATION_ENDPOINTS.resume,
              model: body.model,
              body: text,
            },
          );
        }

        for await (const resumeEvent of withChatGPTStreamIdleTimeout(
          streamChatGPTSse(resumeRes as any),
          signal,
          CHATGPT_STREAM_RESUME_IDLE_TIMEOUT_MS,
          "ChatGPT conversation resume stream",
        )) {
          const resumeResult = processRawEvent(resumeEvent);
          if (resumeResult.type === "chunk") {
            markUsefulProgress();
            yield resumeResult.chunk;
          } else if (resumeResult.type === "complete") {
            markUsefulProgress();
            streamCompleted = true;
            break;
          } else {
            assertFirstChunkProgress("ChatGPT conversation resume stream");
            assertUsefulProgress("ChatGPT conversation resume stream");
          }
        }
      }

      break;
    }

    if (!signal.aborted && (yielded || streamCompleted)) {
      yield chatGPTConversationChunk(body.model, "", "stop");
    }
  }

  private async *codexResponsesStream(
    body: ChatCompletionCreateParamsStreaming,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const codexBody = chatMessagesToCodexBody(
      body.model,
      body.messages as any[],
      chatCompletionToCodexOptions(body),
    );

    const res = await fetchWithTimeout(
      `${CODEX_BASE}/responses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(codexBody),
      },
      signal,
      CHATGPT_HTTP_REQUEST_TIMEOUT_MS,
      "ChatGPT Codex responses",
    );

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

    for await (const event of withChatGPTStreamIdleTimeout(
      streamSse(res as any),
      signal,
      CHATGPT_CODEX_RESPONSE_IDLE_TIMEOUT_MS,
      "ChatGPT Codex responses stream",
    )) {
      // The Codex backend SSE events match the OpenAI Responses API stream format.
      // `obfuscation` fields are transport metadata — skip them.
      // obfuscation is a transport field on delta events — only skip events with no type
      if (!event || !event.type) continue;

      const chunk = fromResponsesChunk(state, event as any);
      if (chunk) yield chunk;
    }
  }

  // ── chatCompletionStream ──────────────────────────────────────────────────

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const headers = await this.authHeaders();
    const backendMode = resolveEffectiveChatGPTBackendMode(
      body as any,
      (body as any).chatgptBackendMode,
      this.config.chatgptBackendMode,
    );

    if (backendMode === "chatgpt") {
      try {
        yield* this.chatGPTConversationStream(body, headers, signal);
      } catch (error) {
        if (!isChatGPTRecoverableStreamError(error)) {
          throw error;
        }
        yield* this.codexResponsesStream(body, headers, signal);
      }
      return;
    }
    yield* this.codexResponsesStream(body, headers, signal);
  }

  // ── chatCompletionNonStream ───────────────────────────────────────────────
  // The ChatGPT Codex backend requires stream=true on every request.
  // We implement non-streaming by collecting all stream chunks.

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    const backendMode = resolveEffectiveChatGPTBackendMode(
      body as any,
      (body as any).chatgptBackendMode,
      this.config.chatgptBackendMode,
    );
    if (backendMode === "chatgpt") {
      let fullText = "";
      let responseId = "chatgpt-conversation";
      for await (const chunk of this.chatCompletionStream(
        { ...body, stream: true } as any,
        signal,
      )) {
        responseId = chunk.id ?? responseId;
        const content = chunk.choices?.[0]?.delta?.content;
        if (typeof content === "string") {
          fullText += content;
        }
      }

      return {
        id: responseId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
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
      chatCompletionToCodexOptions(body),
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

    for await (const event of withChatGPTStreamIdleTimeout(
      streamSse(res as any),
      signal,
      CHATGPT_CODEX_RESPONSE_IDLE_TIMEOUT_MS,
      "ChatGPT Codex responses stream",
    )) {
      // obfuscation is a transport field on delta events — only skip events with no type
      if (!event || !event.type) continue;
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
