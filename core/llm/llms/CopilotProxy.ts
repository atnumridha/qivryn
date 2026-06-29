import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

/**
 * CopilotProxy LLM Provider
 *
 * Routes Continue requests through the codex-oca-tool local Copilot proxy
 * (http://127.0.0.1:8787/v1) which exports the VS Code GitHub Copilot session
 * to an OpenAI-compatible endpoint.
 *
 * The proxy handles:
 *  - Bearer-token refresh via ~/.codex/copilot-auth.json
 *  - Chat-only model translation (e.g. Claude models) through /chat/completions
 *  - Model catalog served from /v1/models
 *
 * Prerequisites:
 *  1. Install the VS Code codex-oca-bridge extension and run
 *     "Codex Copilot: Export Token and Enable" once.
 *  2. Start the local proxy:
 *       bash ~/.codex/bin/codex-copilot enable
 *     or keep it running with the double-click launcher.
 *
 * Auth is supplied via the Authorization header (Bearer <copilot-token>).
 * The apiKey field should be set to the Copilot bearer token, or you can
 * leave it empty and rely on the proxy's built-in token management — the
 * proxy accepts any non-empty Authorization header and replaces it with its
 * own refreshed Copilot token before forwarding to GitHub.
 *
 * @see /Users/atanumridha/Documents/codex-oca-tool
 */
class CopilotProxy extends OpenAI {
  static providerName = "copilot-proxy";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "http://127.0.0.1:8787/v1/",
    model: "gpt-5.3-codex",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
    requestOptions: {
      headers: {
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Plugin-Version": "continue/copilot-proxy",
      },
    },
  };

  protected override _getHeaders(): Record<string, string> {
    return {
      ...super._getHeaders(),
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Plugin-Version": "continue/copilot-proxy",
    };
  }
}

export default CopilotProxy;
