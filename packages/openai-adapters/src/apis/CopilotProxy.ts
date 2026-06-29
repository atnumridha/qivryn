import { OpenAIApi } from "./OpenAI.js";
import { OpenAIConfig } from "../types.js";

export interface CopilotProxyConfig extends OpenAIConfig {}

/**
 * CopilotProxy API adapter for Continue.
 *
 * Forwards requests to the local codex-oca-tool Copilot proxy
 * (http://127.0.0.1:8787/v1) which bridges the VS Code GitHub Copilot
 * session to an OpenAI-compatible API.
 *
 * The proxy:
 *  - Auto-refreshes the Copilot bearer token using the exported GitHub OAuth
 *    token stored in ~/.codex/copilot-auth.json
 *  - Translates /v1/responses or /v1/chat/completions requests transparently
 *  - Serves a live model list at /v1/models
 *
 * @see https://github.com/atnumridha/codex-oca-tool
 */
export class CopilotProxyApi extends OpenAIApi {
  constructor(config: CopilotProxyConfig) {
    super({
      ...config,
      apiBase: config.apiBase ?? "http://127.0.0.1:8787/v1/",
    });
  }

  protected override getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Plugin-Version": "continue/copilot-proxy",
    };
  }
}

export default CopilotProxyApi;
