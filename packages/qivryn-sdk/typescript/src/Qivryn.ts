import { decodePackageSlug } from "@qivryn/config-yaml";
import type { OpenAI } from "openai";
import { Configuration, DefaultApi } from "../api/dist/index.js";
import { Assistant } from "./Assistant.js";
import { createOpenAIClient } from "./createOpenAIClient.js";

export interface QivrynClientOptions {
  /**
   * The assistant identifier in the format owner-slug/package-slug
   * If not provided, only the Qivryn API client will be returned
   */
  assistant?: string;

  /**
   * API Key Authentication
   *
   * API keys must be prefixed with "con_" and provided in the Authorization header.
   * Example: `Authorization: Bearer con_your_api_key_here`
   *
   * API keys can be generated in the Qivryn Hub web interface under account settings.
   */
  apiKey: string;

  /**
   * Optional organization ID
   *
   * TODO: This should be an org name, not the UUID
   */
  organizationId?: string;

  /**
   * Base URL for the Qivryn API
   */
  baseURL?: string;
}

export type QivrynClient = {
  /**
   * The Qivryn API client
   */
  api: DefaultApi;

  /**
   * The OpenAI client configured to use the Qivryn API
   */
  client: OpenAI;

  /**
   * The full YAML configuration for the assistant, along
   * with some additional utility methods
   */
  assistant: Assistant;
};

export type QivrynClientBase = {
  /**
   * The Qivryn API client
   */
  api: DefaultApi;
};

export class Qivryn {
  /**
   * Create a Qivryn instance with a specific assistant
   *
   * When you provide an assistant name, this returns a full client with:
   * - Qivryn API access
   * - A configured OpenAI-compatible client
   * - Assistant configuration and helper methods
   *
   * @param options - Configuration including your API key and assistant name
   * @returns Full Qivryn environment with API client, LLM client, and assistant config
   */
  static async from(
    options: QivrynClientOptions & { assistant: string },
  ): Promise<QivrynClient>;

  /**
   * Create a simple Qivryn API client
   *
   * When you don't specify an assistant, this returns just the Qivryn API client
   * for making direct API calls.
   *
   * @param options - Configuration including your API key
   * @returns Just the Qivryn API client
   */
  static async from(
    options: QivrynClientOptions & { assistant?: undefined },
  ): Promise<QivrynClientBase>;

  /**
   * Internal implementation
   */
  static async from(
    options: QivrynClientOptions,
  ): Promise<QivrynClientBase | QivrynClient> {
    const baseURL = options.baseURL || "https://api.qivryn.ai/";

    const qivrynClient = new DefaultApi(
      new Configuration({
        basePath: baseURL,
        accessToken: options.apiKey
          ? async () => options.apiKey as string
          : undefined,
      }),
    );

    if (!options.assistant) {
      return { api: qivrynClient };
    }

    const { ownerSlug, packageSlug } = decodePackageSlug(options.assistant);
    if (!ownerSlug || !packageSlug) {
      throw new Error(
        `Invalid assistant identifier: ${options.assistant}. Expected format: owner-slug/package-slug`,
      );
    }

    const assistants = await qivrynClient.listAssistants({
      organizationId: options.organizationId,
      alwaysUseProxy: "true",
    });

    const assistantRes = assistants.find(
      (a) => a.ownerSlug === ownerSlug && a.packageSlug === packageSlug,
    );

    if (!assistantRes) {
      throw new Error(`Assistant ${options.assistant} not found`);
    }

    const assistant = new Assistant(assistantRes.configResult.config);

    const client = createOpenAIClient({
      models: assistant.config.models,
      organizationId: options.organizationId || null,
      apiKey: options.apiKey,
      baseURL: baseURL,
    });

    return {
      api: qivrynClient,
      client,
      assistant,
    };
  }
}
