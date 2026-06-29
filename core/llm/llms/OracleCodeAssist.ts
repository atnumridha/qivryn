import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LLMOptions } from "../../index.js";
import { osModelsEditPrompt } from "../templates/edit.js";
import OpenAI from "./OpenAI.js";

// ─── Auth file ───────────────────────────────────────────────────────────────
// Written by: bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login
// Structure:  { "ocaApiKey": "<JWT access token>", ... }
const OCA_SECRETS_FILE = path.join(
  os.homedir(), ".codex", "oca-secrets.json",
);

// OCA LiteLLM endpoint (Oracle internal)
const OCA_BASE_URL =
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

// Required OCI client headers
const CLIENT_VERSION = "0.137.0";

function readOcaToken(): string {
  // 1. Try the secrets file (preferred — managed by codex-oca-tool refresh)
  try {
    if (fs.existsSync(OCA_SECRETS_FILE)) {
      const secrets = JSON.parse(
        fs.readFileSync(OCA_SECRETS_FILE, "utf8"),
      ) as Record<string, unknown>;
      const token = secrets?.ocaApiKey;
      if (typeof token === "string" && token.trim()) return token.trim();
    }
  } catch {
    // fall through to env var
  }

  // 2. Fall back to environment variable
  const envKey = process.env.OCA_API_KEY ?? "";
  if (envKey.trim()) return envKey.trim();

  throw new Error(
    `OCA auth not found.\n` +
      `Run: bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login\n` +
      `This writes the access token to ${OCA_SECRETS_FILE}.\n` +
      `Alternatively, set the OCA_API_KEY environment variable or add it to ~/.continue/.env`,
  );
}

/**
 * OracleCodeAssist LLM provider for Continue.
 *
 * Connects **directly** to Oracle Code Assist's LiteLLM HTTPS endpoint —
 * no proxy, no daemon, no local server.
 *
 * Auth is managed automatically:
 *  - Reads `~/.codex/oca-secrets.json` for the JWT access token.
 *  - Falls back to the `OCA_API_KEY` environment variable (or ~/.continue/.env).
 *  - Token is re-read from the secrets file on each provider construction,
 *    so a `codex-oca-temp.sh refresh` + VS Code reload always picks up the
 *    new token without any config change.
 *
 * Setup (one time):
 *   bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login
 *
 * Token refresh (when expired):
 *   bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
 *   # Then reload VS Code (Developer: Reload Window)
 */
class OracleCodeAssist extends OpenAI {
  static providerName = "oca";

  static defaultOptions: Partial<LLMOptions> = {
    apiBase: `${OCA_BASE_URL}/v1/`,
    model: "oca/gpt-5.3-codex",
    useLegacyCompletionsEndpoint: false,
    promptTemplates: {
      edit: osModelsEditPrompt,
    },
  };

  constructor(options: LLMOptions) {
    // Resolve apiKey at construction time:
    // explicit config value  →  secrets file  →  env var
    if (!options.apiKey) {
      options = { ...options, apiKey: readOcaToken() };
    }
    super(options);
  }

  protected override _getHeaders(): Record<string, string> {
    return {
      ...super._getHeaders(),
      // Required Oracle Cloud Infrastructure headers
      client: "Continue",
      "client-version": CLIENT_VERSION,
      "client-ide": "vscode",
      "client-ide-version": CLIENT_VERSION,
    };
  }
}

export default OracleCodeAssist;
