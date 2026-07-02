export interface SlackAuthorization {
  workspaceId: string;
  workspaceName?: string;
  channelIds: string[];
  allowRead: boolean;
  allowWrite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate?: boolean;
}

export interface SlackMessage {
  channelId: string;
  timestamp: string;
  text: string;
  userId?: string;
  threadTimestamp?: string;
}

export interface SlackApiClient {
  authenticate(
    token: string,
  ): Promise<{ workspaceId: string; workspaceName?: string }>;
  listChannels(token: string): Promise<SlackChannel[]>;
  readMessages(
    token: string,
    channelId: string,
    limit: number,
  ): Promise<SlackMessage[]>;
  postMessage(
    token: string,
    channelId: string,
    text: string,
    threadTimestamp?: string,
  ): Promise<SlackMessage>;
}

export interface SlackCredentialStore {
  initialize(): Promise<void>;
  getAuthorization(): Promise<SlackAuthorization | undefined>;
  saveAuthorization(authorization: SlackAuthorization): Promise<void>;
  getToken(): Promise<string | undefined>;
  saveToken(token: string): Promise<void>;
  clear(): Promise<void>;
}
