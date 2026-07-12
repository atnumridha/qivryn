import {
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  CommandLineIcon,
  CubeTransparentIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import type {
  CodexImportInventory,
  CodexImportKind,
} from "core/config/codex/codexImportManager";
import { useCallback, useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../../context/IdeMessenger";

const CATEGORY_META: Array<{
  kind: CodexImportKind;
  label: string;
  description: string;
  Icon: typeof CommandLineIcon;
}> = [
  {
    kind: "mcp",
    label: "MCP servers",
    description: "Commands, endpoints, headers, and enabled state",
    Icon: CommandLineIcon,
  },
  {
    kind: "plugin",
    label: "Plugins",
    description: "Linked read-only from the active Codex cache",
    Icon: PuzzlePieceIcon,
  },
  {
    kind: "skill",
    label: "Skills",
    description: "Global and plugin skills available by name",
    Icon: BoltIcon,
  },
  {
    kind: "hook",
    label: "Hooks",
    description: "Event matchers, commands, timeouts, and review state",
    Icon: CubeTransparentIcon,
  },
  {
    kind: "rule",
    label: "Instructions",
    description: "Global AGENTS.md and Codex rules",
    Icon: DocumentTextIcon,
  },
  {
    kind: "agent",
    label: "Agent profiles",
    description: "Skill agent metadata and subagent definitions",
    Icon: CubeTransparentIcon,
  },
  {
    kind: "automation",
    label: "Scheduled tasks",
    description: "RRULE schedule and paused or active state",
    Icon: ClockIcon,
  },
];

function formatScanTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not scanned" : date.toLocaleString();
}

export function CodexImportPanel({ onApplied }: { onApplied: () => void }) {
  const ideMessenger = useContext(IdeMessengerContext);
  const [inventory, setInventory] = useState<CodexImportInventory>();
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>();
  const [expandedKind, setExpandedKind] = useState<CodexImportKind>();
  const [query, setQuery] = useState("");
  const [operationKey, setOperationKey] = useState<string>();
  const [reviewingHook, setReviewingHook] = useState<string>();

  const scan = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const response = await ideMessenger.request(
      "extensions/codexImportPreview",
      undefined,
    );
    setLoading(false);
    if (response.status === "error") {
      setError(response.error);
      return;
    }
    setInventory(response.content);
  }, [ideMessenger]);

  useEffect(() => void scan(), [scan]);

  const apply = async () => {
    setApplying(true);
    setError(undefined);
    const response = await ideMessenger.request("extensions/codexImportApply", {
      kinds: CATEGORY_META.map((category) => category.kind),
    });
    setApplying(false);
    if (response.status === "error") {
      setError(response.error);
      return;
    }
    setInventory(response.content.inventory);
    onApplied();
  };

  const setEnabled = async (
    kind: CodexImportKind,
    id: string,
    enabled: boolean,
    reviewed?: boolean,
  ) => {
    const key = `${kind}:${id}`;
    setOperationKey(key);
    setError(undefined);
    const response = await ideMessenger.request(
      "extensions/codexImportSetEnabled",
      { kind, id, enabled, reviewed },
    );
    setOperationKey(undefined);
    if (response.status === "error") {
      setError(response.error);
      return;
    }
    setInventory(response.content.inventory);
    setReviewingHook(undefined);
    onApplied();
  };

  const total = inventory
    ? Object.values(inventory.counts).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <section
      className="qivryn-codex-import"
      aria-labelledby="codex-import-title"
    >
      <header className="qivryn-settings-heading">
        <div className="min-w-0 flex-1">
          <h2 id="codex-import-title">Codex</h2>
          <p>
            Keep Qivryn synchronized with the capabilities configured in the
            ChatGPT Codex desktop app.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="qivryn-icon-button"
            aria-label="Rescan Codex capabilities"
            title="Rescan Codex capabilities"
            disabled={loading || applying}
            onClick={() => void scan()}
          >
            <ArrowPathIcon
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
          </button>
          <button
            type="button"
            className="qivryn-primary-button"
            disabled={loading || applying || total === 0}
            onClick={() => void apply()}
          >
            {applying ? "Importing…" : "Import all"}
          </button>
        </div>
      </header>

      <div className="qivryn-import-status" role="status">
        <span
          className="qivryn-status-dot"
          data-state={error ? "error" : "ready"}
        />
        <span className="min-w-0 flex-1 truncate">
          {loading
            ? "Reading Codex configuration…"
            : error
              ? "Codex configuration could not be read"
              : `${total} capabilities found in ${inventory?.sourceRoot ?? "~/.codex"}`}
        </span>
        {inventory && (
          <time className="text-description-muted text-2xs hidden min-[620px]:inline">
            {formatScanTime(inventory.scannedAt)}
          </time>
        )}
      </div>

      <label className="qivryn-settings-search">
        <MagnifyingGlassIcon className="h-4 w-4" />
        <input
          aria-label="Search Codex capabilities"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search MCPs, plugins, skills, hooks, and agents"
        />
      </label>

      {error && (
        <div className="qivryn-inline-warning" role="alert">
          <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        className="qivryn-settings-rows"
        aria-label="Codex capability inventory"
      >
        {CATEGORY_META.map(({ kind, label, description, Icon }) => {
          const count = inventory?.counts[kind] ?? 0;
          const normalizedQuery = query.trim().toLowerCase();
          const items = (inventory?.items ?? []).filter(
            (item) =>
              item.kind === kind &&
              (!normalizedQuery ||
                `${item.name} ${item.detail ?? ""} ${item.sourcePath ?? ""}`
                  .toLowerCase()
                  .includes(normalizedQuery)),
          );
          const imported =
            items.length > 0 &&
            items.every((item) => item.state !== "available");
          const expanded = expandedKind === kind;
          return (
            <div className="qivryn-settings-row-wrap" key={kind}>
              <button
                type="button"
                className="qivryn-settings-row"
                aria-expanded={expanded}
                onClick={() => setExpandedKind(expanded ? undefined : kind)}
              >
                <span className="qivryn-settings-row-icon">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <strong>{label}</strong>
                  <span>{description}</span>
                </span>
                {imported && (
                  <CheckCircleIcon className="text-success h-4 w-4 flex-shrink-0" />
                )}
                <span className="qivryn-count-badge">{count}</span>
              </button>
              {expanded && (
                <div className="qivryn-import-items">
                  {items.slice(0, 100).map((item) => {
                    const key = `${item.kind}:${item.id}`;
                    const reviewing = reviewingHook === key;
                    return (
                      <div className="qivryn-import-item-wrap" key={key}>
                        <div className="qivryn-import-item">
                          <span
                            className="qivryn-status-dot"
                            data-state={item.enabled ? "ready" : "muted"}
                          />
                          <span
                            className="min-w-0 flex-1"
                            title={item.sourcePath}
                          >
                            <strong className="block truncate font-normal">
                              {item.name}
                            </strong>
                            <span className="text-description-muted text-2xs block truncate">
                              {item.detail ?? item.state}
                            </span>
                          </span>
                          <span className="qivryn-import-state">
                            {item.state === "needs-review"
                              ? "Review required"
                              : item.state}
                          </span>
                          {item.kind === "hook" && !item.reviewed ? (
                            <button
                              type="button"
                              className="qivryn-secondary-button"
                              onClick={() =>
                                setReviewingHook(reviewing ? undefined : key)
                              }
                            >
                              Review
                            </button>
                          ) : item.canToggle ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={item.enabled}
                              aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
                              disabled={operationKey === key}
                              className="qivryn-switch"
                              onClick={() =>
                                void setEnabled(
                                  item.kind,
                                  item.id,
                                  !item.enabled,
                                )
                              }
                            >
                              <span />
                            </button>
                          ) : null}
                        </div>
                        {reviewing && (
                          <div className="qivryn-hook-review">
                            <ShieldCheckIcon className="h-4 w-4 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <strong>Review executable hook</strong>
                              <p>
                                This command runs outside the chat response
                                flow. Enable it only if you trust the source
                                file and command.
                              </p>
                              <code>{item.detail}</code>
                            </div>
                            <button
                              type="button"
                              className="qivryn-primary-button"
                              disabled={operationKey === key}
                              onClick={() =>
                                void setEnabled(item.kind, item.id, true, true)
                              }
                            >
                              Trust and enable
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="qivryn-import-empty">
                      Nothing configured.
                    </div>
                  )}
                  {items.length > 100 && (
                    <div className="qivryn-import-empty">
                      Refine the search to see {items.length - 100} more.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(inventory?.issues.length ?? 0) > 0 && (
        <details className="qivryn-import-issues">
          <summary>{inventory!.issues.length} import notices</summary>
          <ul>
            {inventory!.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
