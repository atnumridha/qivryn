import type {
  SlackApiClient,
  SlackChannel,
  SlackMessage,
} from "./contracts.js";

export class SlackWebApiError extends Error {}

export class SlackWebApiClient implements SlackApiClient {
  constructor(private readonly baseUrl = "https://slack.com/api") {}

  async authenticate(token: string) {
    const data = await this.call<{ team_id: string; team?: string }>(
      token,
      "auth.test",
    );
    return { workspaceId: data.team_id, workspaceName: data.team };
  }

  async listChannels(token: string): Promise<SlackChannel[]> {
    const data = await this.call<{
      channels: Array<{ id: string; name: string; is_private?: boolean }>;
    }>(token, "conversations.list", {
      limit: "200",
      types: "public_channel,private_channel",
    });
    return data.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      isPrivate: channel.is_private,
    }));
  }

  async readMessages(
    token: string,
    channelId: string,
    limit: number,
  ): Promise<SlackMessage[]> {
    const data = await this.call<{
      messages: Array<{
        ts: string;
        text?: string;
        user?: string;
        thread_ts?: string;
      }>;
    }>(token, "conversations.history", {
      channel: channelId,
      limit: String(Math.max(1, Math.min(100, limit))),
    });
    return data.messages.map((message) => ({
      channelId,
      timestamp: message.ts,
      text: message.text ?? "",
      userId: message.user,
      threadTimestamp: message.thread_ts,
    }));
  }

  async postMessage(
    token: string,
    channelId: string,
    text: string,
    threadTimestamp?: string,
  ): Promise<SlackMessage> {
    const data = await this.call<{ ts: string }>(
      token,
      "chat.postMessage",
      {
        channel: channelId,
        text,
        ...(threadTimestamp ? { thread_ts: threadTimestamp } : {}),
      },
      true,
    );
    return { channelId, timestamp: data.ts, text, threadTimestamp };
  }

  private async call<T>(
    token: string,
    method: string,
    parameters: Record<string, string> = {},
    post = false,
  ): Promise<T> {
    const response = await fetch(
      post
        ? `${this.baseUrl}/${method}`
        : `${this.baseUrl}/${method}?${new URLSearchParams(parameters)}`,
      {
        method: post ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(post ? { "content-type": "application/json" } : {}),
        },
        body: post ? JSON.stringify(parameters) : undefined,
      },
    );
    const data = (await response.json()) as T & {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || data.ok === false) {
      throw new SlackWebApiError(
        data.error ?? `Slack ${method} failed (${response.status})`,
      );
    }
    return data;
  }
}
