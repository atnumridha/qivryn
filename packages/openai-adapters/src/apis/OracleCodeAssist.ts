import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OpenAIApi } from "./OpenAI.js";
import { OpenAIConfig } from "../types.js";

const OCA_SECRETS_FILE = path.join(os.homedir(), ".codex", "oca-secrets.json");
const OCA_BASE_URL =
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm";

export interface OracleCodeAssistConfig extends OpenAIConfig {}

function readOcaToken(): string {
  try {
    if (fs.existsSync(OCA_SECRETS_FILE)) {
      const secrets = JSON.parse(fs.readFileSync(OCA_SECRETS_FILE, "utf8"));
      return secrets?.ocaApiKey ?? "";
    }
  } catch {
    // ignore
  }
  return process.env.OCA_API_KEY ?? "";
}

/**
 * OracleCodeAssist API adapter for Continue.
 *
 * Connects to Oracle Code Assist's LiteLLM endpoint using an OAuth access
 * token managed by codex-oca-tool.
 *
 * Auth setup:
 *   bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login
 *   # Writes ~/.codex/oca-secrets.json  →  { "ocaApiKey": "<JWT>" }
 *
 * @see /Users/atanumridha/Documents/codex-oca-tool/docs/macos.md#oca-flow
 */
export class OracleCodeAssistApi extends OpenAIApi {
  constructor(config: OracleCodeAssistConfig) {
    super({
      ...config,
      apiBase: config.apiBase ?? `${OCA_BASE_URL}/v1/`,
      apiKey: config.apiKey ?? readOcaToken(),
    });
  }

  protected override getHeaders(): Record<string, string> {
    const version = "0.137.0";
    return {
      ...super.getHeaders(),
      client: "Continue",
      "client-version": version,
      "client-ide": "vscode",
      "client-ide-version": version,
    };
  }
}

export default OracleCodeAssistApi;
