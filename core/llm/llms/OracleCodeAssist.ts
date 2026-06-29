import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

const OCA_SECRETS_FILE = path.join(os.homedir(), ".codex", "oca-secrets.json");
const OCA_BASE_URL =
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

/**
 * OracleCodeAssist LLM Provider
 *
 * Routes Continue requests through Oracle Code Assist (OCA) — Oracle's
 * internal LiteLLM endpoint that exposes GPT-5.3-Codex and other models.
 *
 * Auth flow (managed by codex-oca-tool):
 *  1. Run `bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login`
 *     This runs an OAuth PKCE flow and writes tokens to:
 *     ~/.codex/oca-secrets.json  →  { ocaApiKey: "<JWT>", ... }
 *  2. Tokens auto-refresh through the helper before they expire.
 *
 * At runtime this provider reads ocaApiKey from oca-secrets.json directly
 * so it does not require setting an environment variable. If the secrets
 * file is absent the provider falls back to process.env.OCA_API_KEY.
 *
 * Required OCI headers (added automatically):
 *   client / client-version / client-ide / client-ide-version / opc-request-id
 *
 * @see /Users/atanumridha/Documents/codex-oca-tool/docs/macos.md#oca-flow
 */
class OracleCodeAssist extends OpenAI {
  static providerName = "oca";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: `${OCA_BASE_URL}/v1/`,
    model: "oca/gpt-5.3-codex",
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
    useLegacyCompletionsEndpoint: false,
  };

  constructor(options: LLMOptions) {
    // If no apiKey is explicitly supplied, read it from the OCA secrets file.
    if (!options.apiKey) {
      const keyFromEnv = process.env.OCA_API_KEY;
      let keyFromFile: string | undefined;
      try {
        if (fs.existsSync(OCA_SECRETS_FILE)) {
          const secrets = JSON.parse(fs.readFileSync(OCA_SECRETS_FILE, "utf8"));
          keyFromFile = secrets?.ocaApiKey ?? undefined;
        }
      } catch {
        // ignore parse errors — caller will get an auth error from OCA
      }
      options = { ...options, apiKey: keyFromFile ?? keyFromEnv ?? "" };
    }
    super(options);
  }

  protected override _getHeaders(): Record<string, string> {
    const version = "0.137.0";
    return {
      ...super._getHeaders(),
      client: "Continue",
      "client-version": version,
      "client-ide": "vscode",
      "client-ide-version": version,
    };
  }
}

export default OracleCodeAssist;
