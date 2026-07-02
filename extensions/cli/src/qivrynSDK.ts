import { Qivryn, QivrynClient } from "@qivryn/sdk";
import chalk from "chalk";

import { env } from "./env.js";

/**
 * Initialize the Qivryn SDK with the given parameters
 * @param apiKey - API key to use for authentication
 * @param assistantSlug - Slug of the assistant to use
 * @param organizationId - Optional organization ID
 * @returns Promise resolving to the Qivryn SDK instance
 */
export async function initializeQivrynSDK(
  apiKey: string | undefined,
  assistantSlug: string,
  organizationId?: string,
): Promise<QivrynClient> {
  if (!apiKey) {
    console.error(chalk.red("Error: No API key provided for Qivryn SDK"));
    throw new Error("No API key provided for Qivryn SDK");
  }

  try {
    return await Qivryn.from({
      apiKey,
      assistant: assistantSlug,
      organizationId,
      baseURL: env.apiBase,
    });
  } catch (error) {
    console.error(
      chalk.red("Error initializing Qivryn SDK:"),
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
