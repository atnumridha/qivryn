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
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  CodeBracketIcon,
  CommandLineIcon,
  CursorArrowRaysIcon,
  GlobeAltIcon,
  InformationCircleIcon,
  KeyIcon,
  PencilSquareIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { ROUTES } from "../../util/navigation";
import "./browser.css";

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
  const [showComputerUse, setShowComputerUse] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [selector, setSelector] = useState("");
  const [inputText, setInputText] = useState("");
  const [key, setKey] = useState("Enter");

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
    setShowInspector(true);
  };

  return (
    <div className="qivryn-browser-workspace bg-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="qivryn-browser-header border-input flex h-10 flex-shrink-0 items-center gap-2 border-b px-2">
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
        <label className="qivryn-browser-visible-toggle text-description-muted text-2xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          <span aria-hidden="true" className="qivryn-browser-switch" />
          <span>Visible</span>
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

      <div className="qivryn-browser-tabs border-input flex min-w-0 flex-shrink-0 gap-1 overflow-x-auto border-b p-1">
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
          <div className="qivryn-browser-navigation border-input grid min-w-0 flex-shrink-0 grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] gap-1 border-b p-1">
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
              className="qivryn-browser-go-button text-2xs rounded border-none px-3"
            >
              Go
            </button>
          </div>

          <div className="qivryn-browser-actionbar border-input flex min-w-0 flex-shrink-0 flex-wrap gap-1 border-b p-1">
            <button
              aria-label="Capture screenshot"
              title="Capture screenshot"
              onClick={() => void capture()}
              className="qivryn-browser-icon-button border-input hover:bg-list-hover flex items-center justify-center rounded border bg-transparent"
            >
              <CameraIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Inspect DOM"
              title="Inspect DOM"
              onClick={() => void inspect("dom")}
              className="qivryn-browser-icon-button border-input hover:bg-list-hover flex items-center justify-center rounded border bg-transparent"
            >
              <CodeBracketIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Inspect console"
              title="Inspect console"
              onClick={() => void inspect("console")}
              className="qivryn-browser-icon-button border-input hover:bg-list-hover flex items-center justify-center rounded border bg-transparent"
            >
              <CommandLineIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Inspect network"
              title="Inspect network"
              onClick={() => void inspect("network")}
              className="qivryn-browser-icon-button border-input hover:bg-list-hover flex items-center justify-center rounded border bg-transparent"
            >
              <GlobeAltIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Computer use controls"
              aria-expanded={showComputerUse}
              title="Computer use controls"
              onClick={() => setShowComputerUse((current) => !current)}
              className={`border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent ${showComputerUse ? "bg-list-active" : ""}`}
            >
              <CursorArrowRaysIcon className="h-3.5 w-3.5" />
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
              type="button"
              aria-label="Toggle inspector"
              aria-expanded={showInspector}
              title="Inspector"
              onClick={() => setShowInspector((current) => !current)}
              className={`qivryn-browser-icon-button qivryn-browser-inspector-toggle border-input hover:bg-list-hover flex items-center justify-center rounded border bg-transparent ${showInspector ? "bg-list-active" : ""}`}
            >
              <InformationCircleIcon className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label={
                selected.lockOwner === "user"
                  ? "Release browser control"
                  : "Take over browser control"
              }
              title={
                selected.lockOwner === "user"
                  ? "Release browser control"
                  : "Take over browser control"
              }
              onClick={() =>
                void action({
                  action: selected.lockOwner === "user" ? "unlock" : "takeover",
                  sessionId: selected.id,
                })
              }
              className="qivryn-browser-icon-button border-input hover:bg-list-hover ml-auto flex items-center justify-center rounded border bg-transparent"
            >
              {selected.lockOwner === "user" ? (
                <LockOpenIcon className="h-3 w-3" />
              ) : (
                <LockClosedIcon className="h-3 w-3" />
              )}
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
          {showComputerUse && (
            <div
              aria-label="Computer use"
              className="qivryn-browser-computer-use border-input bg-editor grid min-w-0 flex-shrink-0 grid-cols-[minmax(100px,1fr)_auto] gap-1 border-b p-2 min-[620px]:grid-cols-[minmax(140px,1fr)_auto_minmax(140px,1fr)_auto_auto_auto_auto]"
            >
              <input
                aria-label="Element selector"
                value={selector}
                onChange={(event) => setSelector(event.target.value)}
                placeholder="CSS selector"
                className="border-input bg-input h-7 min-w-0 rounded border px-2 text-xs outline-none"
              />
              <button
                type="button"
                aria-label="Click element"
                title="Click element"
                disabled={!selector.trim()}
                onClick={() =>
                  selected &&
                  void action({
                    action: "click",
                    sessionId: selected.id,
                    selector: selector.trim(),
                  })
                }
                className="border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent disabled:opacity-40"
              >
                <CursorArrowRaysIcon className="h-3.5 w-3.5" />
              </button>
              <input
                aria-label="Text to type"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="Text"
                className="border-input bg-input h-7 min-w-0 rounded border px-2 text-xs outline-none"
              />
              <button
                type="button"
                aria-label="Type into element"
                title="Replace selected field text"
                disabled={!selector.trim() || !inputText}
                onClick={() =>
                  selected &&
                  void action({
                    action: "type",
                    sessionId: selected.id,
                    selector: selector.trim(),
                    text: inputText,
                    replace: true,
                  })
                }
                className="border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent disabled:opacity-40"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
              </button>
              <select
                aria-label="Key to press"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="border-input bg-input h-7 min-w-0 rounded border px-1 text-xs"
              >
                <option value="Enter">Enter</option>
                <option value="Tab">Tab</option>
                <option value="Escape">Escape</option>
                <option value="ArrowUp">Arrow up</option>
                <option value="ArrowDown">Arrow down</option>
              </select>
              <button
                type="button"
                aria-label="Press key"
                title={`Press ${key}`}
                onClick={() =>
                  selected &&
                  void action({
                    action: "press",
                    sessionId: selected.id,
                    key,
                  })
                }
                className="border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent"
              >
                <KeyIcon className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll up"
                  title="Scroll up"
                  onClick={() =>
                    selected &&
                    void action({
                      action: "scroll",
                      sessionId: selected.id,
                      deltaY: -600,
                    })
                  }
                  className="border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent"
                >
                  <ArrowUpIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Scroll down"
                  title="Scroll down"
                  onClick={() =>
                    selected &&
                    void action({
                      action: "scroll",
                      sessionId: selected.id,
                      deltaY: 600,
                    })
                  }
                  className="border-input hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border bg-transparent"
                >
                  <ArrowDownIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
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
      <main className="qivryn-browser-main grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden min-[760px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="qivryn-browser-preview flex min-h-0 min-w-0 items-center justify-center overflow-auto p-2">
          {screenshot ? (
            <img
              alt="Browser screenshot"
              src={`data:${screenshot.mediaType};base64,${screenshot.data}`}
              className="border-input max-h-full max-w-full rounded border object-contain"
            />
          ) : (
            <div className="qivryn-browser-empty text-description-muted text-center text-xs">
              <span className="qivryn-browser-empty-icon" aria-hidden="true">
                <GlobeAltIcon />
              </span>
              <strong>No preview captured</strong>
              <span>
                Capture the current page to inspect its rendered state.
              </span>
            </div>
          )}
        </div>
        <aside
          className={`qivryn-browser-inspector border-input min-h-0 min-w-0 overflow-auto border-t p-2 min-[760px]:border-l min-[760px]:border-t-0 ${showInspector ? "is-open" : ""}`}
        >
          <section className="qivryn-browser-inspector-section">
            <div className="mb-1 text-xs font-medium">Inspector</div>
            {details ? (
              <pre className="text-2xs m-0 whitespace-pre-wrap break-words">
                {details}
              </pre>
            ) : (
              <div className="text-description-muted text-2xs">
                DOM, console, and network output appears here.
              </div>
            )}
          </section>

          {selected && (
            <section className="qivryn-browser-inspector-section">
              <div className="mb-2 text-xs font-medium">Agent permissions</div>
              <div className="flex min-w-0 gap-1">
                <select
                  aria-label="Browser permission"
                  value={grantAction}
                  onChange={(event) =>
                    setGrantAction(
                      event.target.value as BrowserPermissionGrant["action"],
                    )
                  }
                  className="border-input bg-input text-2xs min-w-0 flex-1 rounded border px-1"
                >
                  <option value="download">Downloads</option>
                  <option value="dialog">Dialogs</option>
                  <option value="authentication">Authentication</option>
                  <option value="clipboard">Clipboard</option>
                  <option value="geolocation">Geolocation</option>
                  <option value="certificate">Certificate exceptions</option>
                  <option value="navigate">Cross-origin navigation</option>
                  <option value="interaction">Computer use</option>
                </select>
                <button
                  onClick={async () => {
                    let origin: string | undefined;
                    try {
                      origin = selected.url
                        ? new URL(selected.url).origin
                        : undefined;
                    } catch {}
                    const response = await ideMessenger.request(
                      "browser/grant",
                      {
                        sessionId: selected.id,
                        action: grantAction,
                        origin,
                      },
                    );
                    if (response.status === "error") setError(response.error);
                    else setGrants((current) => [...current, response.content]);
                  }}
                  className="border-input hover:bg-list-hover text-2xs rounded border bg-transparent px-2 py-1"
                >
                  Allow
                </button>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap gap-1">
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
            </section>
          )}

          <section className="qivryn-browser-inspector-section">
            <div className="text-2xs font-medium">Audit events</div>
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
          </section>
        </aside>
      </main>
    </div>
  );
}

export default BrowserWorkspace;
