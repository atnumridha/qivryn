import type {
  SlackApiClient,
  SlackAuthorization,
  SlackChannel,
  SlackCredentialStore,
  SlackMessage,
} from "./contracts.js";

export class SlackConnectorService {
  constructor(
    private readonly store: SlackCredentialStore,
    private readonly api: SlackApiClient,
  ) {}

  initialize(): Promise<void> {
    return this.store.initialize();
  }

  status(): Promise<SlackAuthorization | undefined> {
    return this.store.getAuthorization();
  }

  async authorize(input: {
    token: string;
    channelIds: string[];
    allowRead?: boolean;
    allowWrite?: boolean;
  }): Promise<SlackAuthorization> {
    const token = input.token.trim();
    const channelIds = [
      ...new Set(input.channelIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!token) throw new Error("Slack authorization requires a token");
    if (channelIds.length === 0)
      throw new Error("Select at least one Slack channel");
    const identity = await this.api.authenticate(token);
    const now = new Date().toISOString();
    const existing = await this.store.getAuthorization();
    const authorization: SlackAuthorization = {
      ...identity,
      channelIds,
      allowRead: input.allowRead ?? true,
      allowWrite: input.allowWrite ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.saveToken(token);
    await this.store.saveAuthorization(authorization);
    return authorization;
  }

  async revoke(): Promise<void> {
    await this.store.clear();
  }

  async channels(): Promise<SlackChannel[]> {
    const { token, authorization } = await this.credentials("read");
    return (await this.api.listChannels(token)).filter((channel) =>
      authorization.channelIds.includes(channel.id),
    );
  }

  async messages(channelId: string, limit = 50): Promise<SlackMessage[]> {
    const { token } = await this.credentials("read", channelId);
    return this.api.readMessages(token, channelId, limit);
  }

  async post(
    channelId: string,
    text: string,
    threadTimestamp?: string,
  ): Promise<SlackMessage> {
    const body = text.trim();
    if (!body) throw new Error("Slack message cannot be empty");
    const { token } = await this.credentials("write", channelId);
    return this.api.postMessage(token, channelId, body, threadTimestamp);
  }

  private async credentials(
    operation: "read" | "write",
    channelId?: string,
  ): Promise<{ token: string; authorization: SlackAuthorization }> {
    const [token, authorization] = await Promise.all([
      this.store.getToken(),
      this.store.getAuthorization(),
    ]);
    if (!token || !authorization)
      throw new Error("Slack connector is not authorized");
    if (operation === "read" && !authorization.allowRead) {
      throw new Error("Slack read access is not authorized");
    }
    if (operation === "write" && !authorization.allowWrite) {
      throw new Error("Slack write access is not authorized");
    }
    if (channelId && !authorization.channelIds.includes(channelId)) {
      throw new Error(
        `Slack channel ${channelId} is outside the authorized allowlist`,
      );
    }
    return { token, authorization };
  }
}
