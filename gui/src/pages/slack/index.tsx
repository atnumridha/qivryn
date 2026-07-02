import type {
  SlackAuthorization,
  SlackChannel,
  SlackMessage,
} from "@qivryn/slack-connector";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { ROUTES } from "../../util/navigation";

function SlackConnector() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const [authorization, setAuthorization] = useState<SlackAuthorization>();
  const [token, setToken] = useState("");
  const [channelInput, setChannelInput] = useState("");
  const [allowRead, setAllowRead] = useState(true);
  const [allowWrite, setAllowWrite] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadStatus = useCallback(async () => {
    const response = await ideMessenger.request("slack/status", undefined);
    if (response.status === "error") return setError(response.error);
    setAuthorization(response.content);
    if (response.content) {
      setChannelInput(response.content.channelIds.join(", "));
      setAllowRead(response.content.allowRead);
      setAllowWrite(response.content.allowWrite);
    }
  }, [ideMessenger]);

  const loadChannels = useCallback(async () => {
    const response = await ideMessenger.request("slack/channels", undefined);
    if (response.status === "error") return setError(response.error);
    setChannels(response.content);
    setSelectedChannel((current) => current || response.content[0]?.id || "");
  }, [ideMessenger]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    if (authorization) void loadChannels();
  }, [authorization, loadChannels]);

  const authorize = async () => {
    setLoading(true);
    setError(undefined);
    const response = await ideMessenger.request("slack/authorize", {
      token,
      channelIds: channelInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      allowRead,
      allowWrite,
    });
    setLoading(false);
    if (response.status === "error") return setError(response.error);
    setAuthorization(response.content);
    setToken("");
  };

  const readMessages = async () => {
    if (!selectedChannel) return;
    setLoading(true);
    setError(undefined);
    const response = await ideMessenger.request("slack/messages", {
      channelId: selectedChannel,
      limit: 50,
    });
    setLoading(false);
    if (response.status === "error") return setError(response.error);
    setMessages(response.content);
  };

  const post = async () => {
    if (!selectedChannel || !draft.trim()) return;
    setLoading(true);
    setError(undefined);
    const response = await ideMessenger.request("slack/post", {
      channelId: selectedChannel,
      text: draft,
    });
    setLoading(false);
    if (response.status === "error") return setError(response.error);
    setMessages((current) => [...current, response.content]);
    setDraft("");
  };

  return (
    <div className="bg-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="border-input flex h-10 flex-shrink-0 items-center gap-2 border-b px-2">
        <button
          aria-label="Back to chat"
          onClick={() => navigate(ROUTES.HOME)}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
          Slack Connector
        </h1>
        {authorization && (
          <span className="text-success text-2xs flex items-center gap-1">
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            Authorized
          </span>
        )}
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden min-[720px]:grid-cols-[300px_minmax(0,1fr)]">
        <section className="border-input min-w-0 overflow-y-auto border-b p-3 min-[720px]:border-b-0 min-[720px]:border-r">
          <h2 className="m-0 text-xs font-semibold">Explicit authorization</h2>
          <p className="text-description-muted text-2xs my-1">
            The token stays on this machine. Only allowlisted channel IDs can be
            accessed. Posting is disabled unless you enable it.
          </p>
          <label className="text-description-muted text-2xs mt-2 block">
            Bot token
            <input
              aria-label="Slack bot token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                authorization ? "Enter a token to reauthorize" : "xoxb-…"
              }
              className="border-input bg-input mt-1 box-border w-full rounded border px-2 py-1.5 text-xs outline-none"
            />
          </label>
          <label className="text-description-muted text-2xs mt-2 block">
            Allowed channel IDs
            <input
              aria-label="Allowed Slack channels"
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              placeholder="C0123, C0456"
              className="border-input bg-input mt-1 box-border w-full rounded border px-2 py-1.5 text-xs outline-none"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={allowRead}
              onChange={(event) => setAllowRead(event.target.checked)}
            />
            Allow reading
          </label>
          <label className="mt-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={allowWrite}
              onChange={(event) => setAllowWrite(event.target.checked)}
            />
            Allow posting messages
          </label>
          <button
            disabled={loading || !token.trim() || !channelInput.trim()}
            onClick={() => void authorize()}
            className="bg-button mt-3 w-full rounded border-none px-2 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {authorization ? "Reauthorize" : "Authorize Slack"}
          </button>
          {authorization && (
            <button
              onClick={async () => {
                await ideMessenger.request("slack/revoke", undefined);
                setAuthorization(undefined);
                setChannels([]);
                setMessages([]);
              }}
              className="border-error text-error mt-2 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
            >
              Revoke access
            </button>
          )}
          {error && (
            <div
              role="alert"
              className="border-error bg-error/10 text-error text-2xs mt-2 break-words rounded border p-2"
            >
              {error}
            </div>
          )}
        </section>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-2">
          {!authorization ? (
            <div className="text-description-muted m-auto max-w-64 text-center text-xs">
              Authorize a token and a channel allowlist to use Slack locally.
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-shrink-0 gap-1">
                <select
                  aria-label="Slack channel"
                  value={selectedChannel}
                  onChange={(event) => setSelectedChannel(event.target.value)}
                  className="border-input bg-input min-w-0 flex-1 rounded border px-2 py-1.5 text-xs"
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name} · {channel.id}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Read Slack messages"
                  disabled={!allowRead || loading || !selectedChannel}
                  onClick={() => void readMessages()}
                  className="hover:bg-list-hover flex h-8 w-8 items-center justify-center rounded border-none bg-transparent disabled:opacity-50"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
              </div>
              <div
                aria-label="Slack messages"
                className="mt-2 min-h-0 min-w-0 flex-1 overflow-y-auto"
              >
                {messages.map((message) => (
                  <article
                    key={`${message.channelId}-${message.timestamp}`}
                    className="border-input mb-1 min-w-0 rounded border p-2"
                  >
                    <div className="text-description-muted text-2xs">
                      {message.userId ?? "Qivryn"} · {message.timestamp}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-xs">
                      {message.text}
                    </div>
                  </article>
                ))}
                {messages.length === 0 && (
                  <div className="text-description-muted py-8 text-center text-xs">
                    No messages loaded.
                  </div>
                )}
              </div>
              <div className="mt-2 flex min-w-0 flex-shrink-0 gap-1">
                <input
                  aria-label="Slack message"
                  disabled={!allowWrite}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void post();
                  }}
                  placeholder={
                    allowWrite
                      ? "Message allowlisted channel"
                      : "Posting is not authorized"
                  }
                  className="border-input bg-input min-w-0 flex-1 rounded border px-2 py-1.5 text-xs outline-none disabled:opacity-60"
                />
                <button
                  aria-label="Post Slack message"
                  disabled={!allowWrite || !draft.trim() || loading}
                  onClick={() => void post()}
                  className="bg-button flex h-8 w-8 items-center justify-center rounded border-none text-white disabled:opacity-50"
                >
                  <PaperAirplaneIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default SlackConnector;
