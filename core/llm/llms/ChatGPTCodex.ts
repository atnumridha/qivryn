/**
 * ChatGPTCodex LLM provider for Qivryn.
 *
 * Uses ChatGPT backend auth and routes through the Codex responses endpoint by
 * default so Qivryn's agent/tool runtime behaves like the normal Codex path.
 * Set chatgptBackendMode: "chatgpt" to use the ChatGPT conversation endpoint
 * for plain chat requests that do not need local tools.
 *
 * Auth: reads ~/.codex/auth.json, uses .tokens.access_token as the bearer.
 *       Auto-refreshes via .tokens.refresh_token when the token is near expiry.
 *
 * This is completely separate from:
 *   - The public OpenAI Platform API (api.openai.com) — requires OPENAI_API_KEY
 *   - GitHub Copilot (api.githubcopilot.com) — uses the github-copilot provider
 *   - Oracle Code Assist — uses the oca provider
 *
 * Available models (from ~/.codex/models_cache.json on 2026-06-29):
 *   gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5-mini,
 *   claude-sonnet-4.6, claude-opus-4.6, claude-sonnet-4.5, claude-opus-4.5,
 *   claude-haiku-4.5
 *
 * Setup: sign in to Codex Desktop or Codex CLI once. Auth is written to
 *   ~/.codex/auth.json automatically. No extra steps needed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

interface CodexModelMetadata {
  slug?: string;
  id?: string;
  context_window?: number;
  effective_context_window_percent?: number;
}

interface CodexModelsCache {
  models?: CodexModelMetadata[];
}

const CODEX_MODELS_CACHE = path.join(
  os.homedir(),
  ".codex",
  "models_cache.json",
);
const FALLBACK_EFFECTIVE_CONTEXT_LENGTHS: Record<string, number> = {
  // Codex metadata: 372,000 raw tokens with a 95% effective allowance.
  "gpt-5.6-sol": 353_400,
};

export function effectiveCodexContextLength(
  model: string,
  cache: CodexModelsCache,
): number | undefined {
  const metadata = cache.models?.find(
    (candidate) => (candidate.slug ?? candidate.id) === model,
  );
  const rawWindow = metadata?.context_window;
  if (!rawWindow || !Number.isFinite(rawWindow) || rawWindow <= 0) {
    return undefined;
  }

  const effectivePercent = metadata?.effective_context_window_percent ?? 100;
  if (!Number.isFinite(effectivePercent) || effectivePercent <= 0) {
    return undefined;
  }
  return Math.floor((rawWindow * effectivePercent) / 100);
}

function resolveCodexContextLength(model: string): number | undefined {
  try {
    const cache = JSON.parse(
      fs.readFileSync(CODEX_MODELS_CACHE, "utf8"),
    ) as CodexModelsCache;
    const cachedLength = effectiveCodexContextLength(model, cache);
    if (cachedLength) {
      return cachedLength;
    }
  } catch {
    // A missing or stale cache should not prevent the provider from loading.
  }
  return FALLBACK_EFFECTIVE_CONTEXT_LENGTHS[model];
}

class ChatGPTCodex extends OpenAI {
  static providerName = "chatgpt-codex";

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "https://chatgpt.com/backend-api/codex/",
    model: "gpt-5.6-sol",
    chatgptBackendMode: "codex",
    useLegacyCompletionsEndpoint: false,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  constructor(options: LLMOptions) {
    const model = options.model || ChatGPTCodex.defaultOptions.model!;
    super({
      ...options,
      contextLength: options.contextLength ?? resolveCodexContextLength(model),
    });
  }

  // Auth token is managed by ChatGPTCodexApi via ~/.codex/auth.json.
  // No apiKey in config needed.
}

export default ChatGPTCodex;
