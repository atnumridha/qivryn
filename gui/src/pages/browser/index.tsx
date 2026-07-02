import type { BrowserEvent, BrowserSession } from "@qivryn/agent-runtime";
import type {
  BrowserActionRequest,
  BrowserPermissionGrant,
  BrowserScreenshot,
} from "@qivryn/browser-runtime";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CameraIcon,
  CodeBracketIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { ROUTES } from "../../util/navigation";

function BrowserWorkspace() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const associatedRunId = searchParams.get("runId") ?? undefined;
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [url, setUrl] = useState("http://localhost:3000");
  const [visible, setVisible] = useState(false);
  const [screenshot, setScreenshot] = useState<BrowserScreenshot>();
  const [details, setDetails] = useState("");
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [grants, setGrants] = useState<BrowserPermissionGrant[]>([]);
  const [grantAction, setGrantAction] =
    useState<BrowserPermissionGrant["action"]>("download");

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId),
    [selectedId, sessions],
  );

  const load = useCallback(async () => {
    const response = await ideMessenger.request("browser/list", undefined);
    if (response.status === "error") return setError(response.error);
    setSessions(response.content);
    setSelectedId((current) => current ?? response.content[0]?.id);
  }, [ideMessenger]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    void ideMessenger
      .request("browser/events", { sessionId: selectedId })
      .then((response) => {
        if (response.status === "success") setEvents(response.content);
      });
    void ideMessenger
      .request("browser/grants", { sessionId: selectedId })
      .then((response) => {
        if (response.status === "success") setGrants(response.content);
      });
    const session = sessions.find((item) => item.id === selectedId);
    if (session?.url) setUrl(session.url);
  }, [ideMessenger, selectedId, sessions]);

  const create = async () => {
    setLoading(true);
    setError(undefined);
    const response = await ideMessenger.request("browser/create", {
      runId: associatedRunId,
      visible,
      recording: "events",
      viewport: { width: 1280, height: 720 },
    });
    setLoading(false);
    if (response.status === "error") return setError(response.error);
    setSessions((current) => [response.content, ...current]);
    setSelectedId(response.content.id);
  };

  const action = useCallback(
    async (request: BrowserActionRequest) => {
      setLoading(true);
      setError(undefined);
      const response = await ideMessenger.request("browser/action", request);
      setLoading(false);
      if (response.status === "error") {
        setError(response.error);
        return undefined;
      }
      await load();
      return response.content;
    },
    [ideMessenger, load],
  );

  const navigateTo = async () => {
    if (!selected || !url.trim()) return;
    await action({
      action: "navigate",
      sessionId: selected.id,
      url: url.trim(),
    });
  };

  const capture = async () => {
    if (!selected) return;
    const result = await action({
      action: "screenshot",
      sessionId: selected.id,
    });
    if (result && "data" in result) setScreenshot(result as BrowserScreenshot);
  };

  const inspect = async (kind: "dom" | "console" | "network") => {
    if (!selected) return;
    const result = await action({ action: kind, sessionId: selected.id });
    if (kind === "dom" && result && "content" in result) {
      setDetails(String(result.content));
    } else if (Array.isArray(result))
      setDetails(JSON.stringify(result, null, 2));
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
          Browser
        </h1>
        {associatedRunId && (
          <span
            className="text-description-muted text-2xs max-w-32 truncate"
            title={associatedRunId}
          >
            Agent {associatedRunId}
          </span>
        )}
        <label className="text-description-muted text-2xs flex items-center gap-1">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          Visible
        </label>
        <button
          aria-label="New browser session"
          disabled={loading}
          onClick={() => void create()}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="border-input flex min-w-0 flex-shrink-0 gap-1 overflow-x-auto border-b p-1">
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => setSelectedId(session.id)}
            className={`text-2xs flex min-w-24 max-w-48 items-center gap-1 rounded border-none px-2 py-1 ${session.id === selectedId ? "bg-list-active" : "hover:bg-list-hover bg-transparent"}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {session.title || session.url || "New tab"}
            </span>
            {session.locked && (
              <LockClosedIcon className="h-3 w-3 flex-shrink-0" />
            )}
          </button>
        ))}
        {sessions.length === 0 && (
          <span className="text-description-muted text-2xs px-2 py-1">
            Create a headless or visible local browser session.
          </span>
        )}
      </div>

      {selected && (
        <>
          <div className="border-input grid min-w-0 flex-shrink-0 grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] gap-1 border-b p-1">
            <button
              aria-label="Back"
              onClick={() =>
                void action({ action: "back", sessionId: selected.id })
              }
              className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Forward"
              onClick={() =>
                void action({ action: "forward", sessionId: selected.id })
              }
              className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
            >
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Reload"
              onClick={() =>
                void action({ action: "reload", sessionId: selected.id })
              }
              className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
            >
              <ArrowPathIcon
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <input
              aria-label="Browser URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void navigateTo();
              }}
              className="border-input bg-input min-w-0 rounded border px-2 text-xs outline-none"
            />
            <button
              onClick={() => void navigateTo()}
              className="bg-button text-2xs rounded border-none px-2 text-white"
            >
              Go
            </button>
          </div>

          <div className="border-input flex min-w-0 flex-shrink-0 flex-wrap gap-1 border-b p-1">
            <button
              onClick={() => void capture()}
              className="border-input hover:bg-list-hover text-2xs flex items-center gap-1 rounded border bg-transparent px-2 py-1"
            >
              <CameraIcon className="h-3 w-3" />
              Screenshot
            </button>
            <button
              onClick={() => void inspect("dom")}
              className="border-input hover:bg-list-hover text-2xs flex items-center gap-1 rounded border bg-transparent px-2 py-1"
            >
              <CodeBracketIcon className="h-3 w-3" />
              DOM
            </button>
            <button
              onClick={() => void inspect("console")}
              className="border-input hover:bg-list-hover text-2xs rounded border bg-transparent px-2 py-1"
            >
              Console
            </button>
            <button
              onClick={() => void inspect("network")}
              className="border-input hover:bg-list-hover text-2xs rounded border bg-transparent px-2 py-1"
            >
              Network
            </button>
            <select
              aria-label="Recording"
              value={selected.recording}
              onChange={(event) =>
                void action({
                  action: "recording",
                  sessionId: selected.id,
                  recording: event.target.value as BrowserSession["recording"],
                })
              }
              className="border-input bg-input text-2xs rounded border px-1"
            >
              <option value="off">Recording off</option>
              <option value="events">Record events</option>
              <option value="full">Full recording</option>
            </select>
            <button
              onClick={() =>
                void action({
                  action: selected.lockOwner === "user" ? "unlock" : "takeover",
                  sessionId: selected.id,
                })
              }
              className="border-input hover:bg-list-hover text-2xs ml-auto flex items-center gap-1 rounded border bg-transparent px-2 py-1"
            >
              {selected.lockOwner === "user" ? (
                <LockOpenIcon className="h-3 w-3" />
              ) : (
                <LockClosedIcon className="h-3 w-3" />
              )}
              {selected.lockOwner === "user" ? "Release" : "Take over"}
            </button>
            <button
              aria-label="Close browser session"
              onClick={() =>
                void action({ action: "close", sessionId: selected.id })
              }
              className="hover:bg-list-hover flex h-6 w-6 items-center justify-center rounded border-none bg-transparent"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="border-input flex min-w-0 flex-shrink-0 flex-wrap items-center gap-1 border-b p-1">
            <span className="text-description-muted text-2xs">
              Agent permissions
            </span>
            <select
              aria-label="Browser permission"
              value={grantAction}
              onChange={(event) =>
                setGrantAction(
                  event.target.value as BrowserPermissionGrant["action"],
                )
              }
              className="border-input bg-input text-2xs rounded border px-1"
            >
              <option value="download">Downloads</option>
              <option value="dialog">Dialogs</option>
              <option value="authentication">Authentication</option>
              <option value="clipboard">Clipboard</option>
              <option value="geolocation">Geolocation</option>
              <option value="certificate">Certificate exceptions</option>
              <option value="navigate">Cross-origin navigation</option>
            </select>
            <button
              onClick={async () => {
                let origin: string | undefined;
                try {
                  origin = selected.url
                    ? new URL(selected.url).origin
                    : undefined;
                } catch {}
                const response = await ideMessenger.request("browser/grant", {
                  sessionId: selected.id,
                  action: grantAction,
                  origin,
                });
                if (response.status === "error") setError(response.error);
                else setGrants((current) => [...current, response.content]);
              }}
              className="border-input hover:bg-list-hover text-2xs rounded border bg-transparent px-2 py-1"
            >
              Allow for origin
            </button>
            {grants.map((grant) => (
              <button
                key={grant.id}
                title={grant.origin}
                onClick={async () => {
                  await ideMessenger.request("browser/revokeGrant", {
                    sessionId: selected.id,
                    grantId: grant.id,
                  });
                  setGrants((current) =>
                    current.filter((item) => item.id !== grant.id),
                  );
                }}
                className="border-input bg-input text-2xs rounded border px-2 py-1"
              >
                {grant.action} ×
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="border-error bg-error/10 text-error text-2xs mx-2 mt-2 break-words rounded border p-2"
        >
          {error}
        </div>
      )}
      <main className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden min-[760px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-h-0 min-w-0 items-center justify-center overflow-auto p-2">
          {screenshot ? (
            <img
              alt="Browser screenshot"
              src={`data:${screenshot.mediaType};base64,${screenshot.data}`}
              className="border-input max-h-full max-w-full rounded border object-contain"
            />
          ) : (
            <div className="text-description-muted text-center text-xs">
              Capture a screenshot to preview the current page.
              <br />
              Visible sessions also open a controlled browser window.
            </div>
          )}
        </div>
        <aside className="border-input min-h-0 min-w-0 overflow-auto border-t p-2 min-[760px]:border-l min-[760px]:border-t-0">
          <div className="mb-1 text-xs font-semibold">Inspector</div>
          {details ? (
            <pre className="text-2xs m-0 whitespace-pre-wrap break-words">
              {details}
            </pre>
          ) : (
            <div className="text-description-muted text-2xs">
              DOM, console, and network output appears here.
            </div>
          )}
          <div className="border-input text-2xs mt-3 border-t pt-2 font-semibold">
            Audit events
          </div>
          {events
            .slice(-20)
            .reverse()
            .map((event) => (
              <div
                key={event.id}
                className="border-input text-2xs mt-1 flex min-w-0 gap-2 border-b pb-1"
              >
                <span className="min-w-0 flex-1 truncate">{event.kind}</span>
                <span className="text-description-muted">
                  #{event.sequence}
                </span>
              </div>
            ))}
        </aside>
      </main>
    </div>
  );
}

export default BrowserWorkspace;
