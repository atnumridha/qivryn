/**
 * ChatGPTCodex LLM provider for Continue.
 *
 * Uses the ChatGPT Codex backend (chatgpt.com/backend-api/codex) — the same
 * backend used by Codex Desktop and the Codex CLI.
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
import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

class ChatGPTCodex extends OpenAI {
  static providerName = "chatgpt-codex";

  static defaultOptions: Partial<LLMOptions> = {
    // The chatgpt-codex provider is handled by ChatGPTCodexApi in openai-adapters,
    // which calls chatgpt.com/backend-api/codex/responses directly.
    // apiBase here is informational; the adapter overrides it.
    apiBase: "https://chatgpt.com/backend-api/codex/",
    model: "gpt-5.5",
    useLegacyCompletionsEndpoint: false,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  // Auth token is managed by ChatGPTCodexApi via ~/.codex/auth.json.
  // No apiKey in config needed.
}

export default ChatGPTCodex;
