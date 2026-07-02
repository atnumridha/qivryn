import path from "node:path";
import {
  FileSlackCredentialStore,
  SlackConnectorService,
  SlackWebApiClient,
} from "@qivryn/slack-connector";
import { env } from "../env.js";

interface SlackCommandOptions {
  channels?: string;
  write?: boolean;
  tokenEnv?: string;
  channel?: string;
  text?: string;
  thread?: string;
  limit?: string;
  json?: boolean;
}

function service(): SlackConnectorService {
  return new SlackConnectorService(
    new FileSlackCredentialStore(
      path.join(env.qivrynHome, "connectors", "slack"),
    ),
    new SlackWebApiClient(),
  );
}

export async function slackCommand(
  action = "status",
  options: SlackCommandOptions,
): Promise<void> {
  const connector = service();
  await connector.initialize();
  let result: unknown;
  switch (action) {
    case "status":
      result = await connector.status();
      break;
    case "authorize": {
      const tokenEnvironment = options.tokenEnv ?? "SLACK_BOT_TOKEN";
      const token = process.env[tokenEnvironment];
      if (!token)
        throw new Error(`Slack token is missing from ${tokenEnvironment}`);
      result = await connector.authorize({
        token,
        channelIds: (options.channels ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        allowRead: true,
        allowWrite: options.write ?? false,
      });
      break;
    }
    case "revoke":
      await connector.revoke();
      result = { revoked: true };
      break;
    case "channels":
      result = await connector.channels();
      break;
    case "messages":
      if (!options.channel)
        throw new Error("Slack messages requires --channel");
      result = await connector.messages(
        options.channel,
        Number(options.limit ?? 50),
      );
      break;
    case "post":
      if (!options.channel || !options.text) {
        throw new Error("Slack post requires --channel and --text");
      }
      result = await connector.post(
        options.channel,
        options.text,
        options.thread,
      );
      break;
    default:
      throw new Error(`Unknown Slack action: ${action}`);
  }
  if (options.json || typeof result !== "string") {
    console.log(JSON.stringify(result ?? null, null, 2));
  } else {
    console.log(result);
  }
}
