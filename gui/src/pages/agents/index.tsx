import type {
  AgentCheckpoint,
  AgentControlRequest,
  AgentEvent,
  AgentPlan,
  AgentPlanItem,
  AgentQueueItem,
  AgentRun,
  AgentRuntimeStatus,
  AgentRunSnapshot,
  AgentWorktreeResult,
} from "@continuedev/agent-runtime";
import type {
  BaseSessionMetadata,
  ContextProviderDescription,
  ContextSubmenuItem,
} from "core";
import { formatContinueDeepLink } from "@continuedev/agent-runtime/deep-links";
import {
  ArchiveBoxIcon,
  ClockIcon,
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowsPointingOutIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  DocumentPlusIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { exitEdit } from "../../redux/thunks/edit";
import { loadSession, saveCurrentSession } from "../../redux/thunks/session";
import { ROUTES } from "../../util/navigation";
import ModelSelect from "../../components/modelSelection/ModelSelect";
import { ReasoningEffortSelect } from "../../components/modelSelection/ReasoningEffortSelect";
import StyledMarkdownPreview from "../../components/StyledMarkdownPreview";
import "./agents.css";
import { AgentAutomationsPanel } from "./AgentAutomationsPanel";
import { SkillSelect } from "../../components/skills/SkillSelect";
import { AgentAccessModeSelect } from "../../components/mainInput/Lump/LumpToolbar/AgentAccessModeSelect";

const ACTIVE_STATUSES = new Set([
  "draft",
  "queued",
  "running",
  "waiting",
  "attention",
]);

const CHAT_OPEN_TIMEOUT_MS = 15_000;
const LIVE_AGENT_STATUSES = new Set(["queued", "running", "waiting"]);
type AgentStreamMode = "idle" | "connecting" | "live" | "polling";

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new Error(
          "The session did not respond in time. Retry, or reopen the Agents window if the problem continues.",
        ),
      );
    }, milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        window.clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function readableError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return "Unknown session error";
}

function withSkill(prompt: string, skillName?: string): string {
  return skillName
    ? `Use the ${JSON.stringify(skillName)} skill for this task.\n\n${prompt}`
    : prompt;
}

function normalizeFilePath(value: string): string {
  const withoutScheme = value.replace(/^file:\/\//, "");
  try {
    return decodeURIComponent(withoutScheme).replace(/\\/g, "/");
  } catch {
    return withoutScheme.replace(/\\/g, "/");
  }
}

function repositoryFileReference(
  repositoryPath: string,
  candidatePath: string,
): string | undefined {
  const repository = normalizeFilePath(repositoryPath).replace(/\/$/, "");
  const candidate = normalizeFilePath(candidatePath).replace(/^\.\//, "");
  if (!candidate) return undefined;
  if (!candidate.startsWith("/") && !/^[A-Za-z]:\//.test(candidate)) {
    return candidate;
  }
  const prefix = `${repository}/`;
  if (!candidate.startsWith(prefix)) return undefined;
  return candidate.slice(prefix.length);
}

type AgentContextItem =
  | { type: "file"; path: string }
  | { type: "terminal"; contents: string }
  | { type: "git"; branch: string; diff: string[] }
  | { type: "symbols"; path: string; contents: string }
  | {
      type: "provider";
      provider: string;
      label: string;
      query: string;
      contents: string;
    }
  | {
      type: "mcp-prompt";
      server: string;
      name: string;
      contents: string;
    };

function boundedContextSnapshot(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `[Older snapshot output omitted; ${value.length.toLocaleString()} characters total.]\n${value.slice(-maxChars)}`;
}

function withContext(prompt: string, items: AgentContextItem[]): string {
  const files = items.filter(
    (item): item is Extract<AgentContextItem, { type: "file" }> =>
      item.type === "file",
  );
  const snapshots = items.filter((item) => item.type !== "file");
  let result = prompt;
  if (files.length > 0) {
    const references = files
      .map((file) => `- ${JSON.stringify(file.path)}`)
      .join("\n");
    result += `\n\n<context_files>\nRead these repository-relative files as relevant before responding:\n${references}\n</context_files>`;
  }
  for (const snapshot of snapshots) {
    if (snapshot.type === "terminal") {
      result += `\n\n<context_snapshot type="terminal">\n${snapshot.contents}\n</context_snapshot>`;
    } else if (snapshot.type === "git") {
      result += `\n\n<context_snapshot type="git" branch=${JSON.stringify(snapshot.branch)}>\n${snapshot.diff.join("\n")}\n</context_snapshot>`;
    } else if (snapshot.type === "symbols") {
      result += `\n\n<context_snapshot type="symbols" source=${JSON.stringify(snapshot.path)}>\n${snapshot.contents}\n</context_snapshot>`;
    } else if (snapshot.type === "provider") {
      result += `\n\n<context_snapshot type="provider" provider=${JSON.stringify(snapshot.provider)} label=${JSON.stringify(snapshot.label)} query=${JSON.stringify(snapshot.query)}>\n${snapshot.contents}\n</context_snapshot>`;
    } else {
      result += `\n\n<context_snapshot type="mcp-prompt" server=${JSON.stringify(snapshot.server)} name=${JSON.stringify(snapshot.name)}>\n${snapshot.contents}\n</context_snapshot>`;
    }
  }
  return result;
}

function AgentContextPicker({
  repositoryPath,
  items,
  onChange,
}: {
  repositoryPath: string;
  items: AgentContextItem[];
  onChange: (items: AgentContextItem[]) => void;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const contextProviders = useAppSelector(
    (state) => state.config.config.contextProviders ?? [],
  );
  const mcpServers = useAppSelector(
    (state) => state.config.config.mcpServerStatuses ?? [],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [providerTitle, setProviderTitle] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [providerItems, setProviderItems] = useState<ContextSubmenuItem[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const addFile = useCallback(
    (path: string) => {
      const reference = repositoryFileReference(repositoryPath, path);
      if (!reference) {
        setMessage("Choose a file inside this repository.");
        return;
      }
      if (
        !items.some((item) => item.type === "file" && item.path === reference)
      ) {
        onChange([...items, { type: "file", path: reference }]);
      }
      setMessage(undefined);
      setOpen(false);
      setQuery("");
    },
    [items, onChange, repositoryPath],
  );

  const attachActiveFile = useCallback(async () => {
    if (!repositoryPath.trim()) {
      setMessage("Choose a repository first.");
      return;
    }
    const response = await ideMessenger.request("getCurrentFile", undefined);
    if (response.status === "error" || !response.content?.path) {
      setMessage("No saved active file is available.");
      return;
    }
    addFile(response.content.path);
  }, [addFile, ideMessenger, repositoryPath]);

  const attachTerminal = useCallback(async () => {
    const response = await ideMessenger.request(
      "getTerminalContents",
      undefined,
    );
    if (response.status === "error" || !response.content.trim()) {
      setMessage("No terminal output is available.");
      return;
    }
    onChange([
      ...items.filter((item) => item.type !== "terminal"),
      {
        type: "terminal",
        contents: boundedContextSnapshot(response.content, 12_000),
      },
    ]);
    setMessage(undefined);
    setOpen(false);
  }, [ideMessenger, items, onChange]);

  const attachGit = useCallback(async () => {
    if (!repositoryPath.trim()) {
      setMessage("Choose a repository first.");
      return;
    }
    const [branchResponse, diffResponse] = await Promise.all([
      ideMessenger.request("getBranch", { dir: repositoryPath }),
      ideMessenger.request("getDiff", { includeUnstaged: true }),
    ]);
    if (branchResponse.status === "error" || diffResponse.status === "error") {
      setMessage("Git context is unavailable for this repository.");
      return;
    }
    const boundedDiff = boundedContextSnapshot(
      diffResponse.content.join("\n"),
      20_000,
    ).split("\n");
    onChange([
      ...items.filter((item) => item.type !== "git"),
      {
        type: "git",
        branch: branchResponse.content,
        diff: boundedDiff,
      },
    ]);
    setMessage(undefined);
    setOpen(false);
  }, [ideMessenger, items, onChange, repositoryPath]);

  const attachSymbols = useCallback(async () => {
    if (!repositoryPath.trim()) {
      setMessage("Choose a repository first.");
      return;
    }
    let references = items.flatMap((item) =>
      item.type === "file" ? [item.path] : [],
    );
    if (references.length === 0) {
      const currentFile = await ideMessenger.request(
        "getCurrentFile",
        undefined,
      );
      if (currentFile.status === "error" || !currentFile.content?.path) {
        setMessage("Attach a file or open a saved file before adding symbols.");
        return;
      }
      const reference = repositoryFileReference(
        repositoryPath,
        currentFile.content.path,
      );
      if (!reference) {
        setMessage("The active file is outside this repository.");
        return;
      }
      references = [reference];
    }
    const uris = references.map(
      (reference) =>
        `file://${repositoryPath.replace(/\/$/, "")}/${reference.replace(/^\//, "")}`,
    );
    const response = await ideMessenger.request("context/getSymbolsForFiles", {
      uris,
    });
    if (response.status === "error") {
      setMessage(response.error);
      return;
    }
    const additions: AgentContextItem[] = [];
    for (const [uri, symbols] of Object.entries(response.content)) {
      if (symbols.length === 0) continue;
      const path =
        repositoryFileReference(repositoryPath, uri) ?? normalizeFilePath(uri);
      const contents = boundedContextSnapshot(
        symbols
          .map(
            (symbol) =>
              `${symbol.name} (${symbol.type}) lines ${symbol.range.start.line + 1}-${symbol.range.end.line + 1}\n${symbol.content}`,
          )
          .join("\n\n"),
        16_000,
      );
      additions.push({ type: "symbols", path, contents });
    }
    if (additions.length === 0) {
      setMessage(
        "No language-server symbols were found for the selected files.",
      );
      return;
    }
    const paths = new Set(
      additions.flatMap((item) => (item.type === "symbols" ? [item.path] : [])),
    );
    onChange([
      ...items.filter(
        (item) => item.type !== "symbols" || !paths.has(item.path),
      ),
      ...additions,
    ]);
    setMessage(undefined);
    setOpen(false);
  }, [ideMessenger, items, onChange, repositoryPath]);

  const selectedProvider = useMemo(
    () => contextProviders.find((provider) => provider.title === providerTitle),
    [contextProviders, providerTitle],
  );

  const resolveProvider = useCallback(
    async (
      provider: ContextProviderDescription,
      resolvedQuery: string,
      label = provider.displayTitle,
    ) => {
      setLoading(true);
      const response = await ideMessenger.request("context/getContextItems", {
        name: provider.title,
        query: resolvedQuery,
        fullInput: providerQuery,
        selectedCode: [],
        isInAgentMode: true,
      });
      setLoading(false);
      if (response.status === "error") {
        setMessage(response.error);
        return;
      }
      if (response.content.length === 0) {
        setMessage(`${label} returned no context.`);
        return;
      }
      const contents = boundedContextSnapshot(
        response.content
          .map(
            (item) =>
              `## ${item.name}\n${item.description ? `${item.description}\n` : ""}${item.content}`,
          )
          .join("\n\n"),
        24_000,
      );
      onChange([
        ...items.filter(
          (item) =>
            item.type !== "provider" ||
            item.provider !== provider.title ||
            item.query !== resolvedQuery,
        ),
        {
          type: "provider",
          provider: provider.title,
          label,
          query: resolvedQuery,
          contents,
        },
      ]);
      setProviderQuery("");
      setProviderItems([]);
      setMessage(undefined);
      setOpen(false);
    },
    [ideMessenger, items, onChange, providerQuery],
  );

  const prepareProvider = useCallback(async () => {
    if (!selectedProvider) {
      setMessage("Choose a context source.");
      return;
    }
    if (selectedProvider.type === "submenu") {
      setLoading(true);
      const response = await ideMessenger.request("context/loadSubmenuItems", {
        title: selectedProvider.title,
      });
      setLoading(false);
      if (response.status === "error") {
        setMessage(response.error);
        return;
      }
      setProviderItems(response.content);
      if (response.content.length === 0) {
        setMessage(`${selectedProvider.displayTitle} has no resources.`);
      }
      return;
    }
    await resolveProvider(selectedProvider, providerQuery);
  }, [ideMessenger, providerQuery, resolveProvider, selectedProvider]);

  const attachMcpPrompt = useCallback(
    async (
      server: string,
      prompt: { name: string; arguments?: Array<{ name: string }> },
    ) => {
      setLoading(true);
      const args = Object.fromEntries(
        (prompt.arguments ?? []).map((argument) => [argument.name, ""]),
      );
      const response = await ideMessenger.request("mcp/getPrompt", {
        serverName: server,
        promptName: prompt.name,
        args,
      });
      setLoading(false);
      if (response.status === "error") {
        setMessage(response.error);
        return;
      }
      onChange([
        ...items.filter(
          (item) =>
            item.type !== "mcp-prompt" ||
            item.server !== server ||
            item.name !== prompt.name,
        ),
        {
          type: "mcp-prompt",
          server,
          name: prompt.name,
          contents: boundedContextSnapshot(response.content.prompt, 24_000),
        },
      ]);
      setMessage(undefined);
      setOpen(false);
    },
    [ideMessenger, items, onChange],
  );

  const filePaths = useMemo(
    () => items.flatMap((item) => (item.type === "file" ? [item.path] : [])),
    [items],
  );

  useEffect(() => {
    if (!open || !repositoryPath.trim()) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setMessage(undefined);
      const cleanQuery = query.replace(/[\[\]{}*?!\\]/g, "").trim();
      const response = await ideMessenger.request("getFileResults", {
        pattern: cleanQuery ? `**/*${cleanQuery}*` : "**/*",
        maxResults: 40,
      });
      setLoading(false);
      if (response.status === "error") {
        setMessage(response.error);
        return;
      }
      setResults(
        [...new Set(response.content)]
          .map((path) => repositoryFileReference(repositoryPath, path))
          .filter((path): path is string => Boolean(path))
          .filter((path) => !filePaths.includes(path))
          .slice(0, 20),
      );
    }, 120);
    return () => window.clearTimeout(timer);
  }, [filePaths, ideMessenger, open, query, repositoryPath]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <button
          type="button"
          aria-label="Add agent context"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setMessage(undefined);
            setOpen((value) => !value);
          }}
          className="border-input bg-input hover:bg-list-hover flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs"
        >
          <DocumentPlusIcon className="h-3.5 w-3.5" /> Context
          {items.length > 0 ? ` · ${items.length}` : ""}
        </button>
        {items.map((item) => {
          const label =
            item.type === "file"
              ? item.path
              : item.type === "terminal"
                ? "Terminal snapshot"
                : item.type === "git"
                  ? `Git snapshot · ${item.branch}`
                  : item.type === "symbols"
                    ? `Symbols · ${item.path}`
                    : item.type === "provider"
                      ? `${item.label}${item.query ? ` · ${item.query}` : ""}`
                      : `MCP prompt · ${item.server}/${item.name}`;
          return (
            <span
              key={
                item.type === "file"
                  ? `file:${item.path}`
                  : item.type === "symbols"
                    ? `symbols:${item.path}`
                    : item.type === "provider"
                      ? `provider:${item.provider}:${item.query}`
                      : item.type === "mcp-prompt"
                        ? `mcp:${item.server}:${item.name}`
                        : item.type
              }
              title={label}
              className="border-input bg-editor flex max-w-48 items-center gap-1 rounded-full border px-2 py-1 text-[10px]"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() =>
                  onChange(items.filter((candidate) => candidate !== item))
                }
                className="hover:text-foreground cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
      {open && (
        <div
          role="dialog"
          aria-label="Agent context"
          className="cursor-agent-context-menu border-input bg-editor absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[min(22rem,85vw)] overflow-y-auto rounded-lg border p-2 shadow-xl"
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="text-description text-[11px] font-medium">
              Add context
            </span>
            <button
              type="button"
              aria-label="Close agent context"
              onClick={() => setOpen(false)}
              className="text-description hover:text-foreground flex cursor-pointer items-center border-none bg-transparent p-0.5"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void attachActiveFile()}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
            >
              Active file
            </button>
            <button
              type="button"
              onClick={() => void attachTerminal()}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => void attachGit()}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
            >
              Git changes
            </button>
            <button
              type="button"
              onClick={() => void attachSymbols()}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
            >
              File symbols
            </button>
          </div>
          {contextProviders.length > 0 && (
            <details className="border-input mb-2 border-y py-1 text-xs">
              <summary className="text-description hover:text-foreground cursor-pointer px-1 py-1 text-[11px]">
                More context sources
              </summary>
              <div className="px-1 pb-1 pt-1">
                <div className="flex gap-1">
                  <select
                    aria-label="Agent context source"
                    value={providerTitle}
                    onChange={(event) => {
                      setProviderTitle(event.target.value);
                      setProviderItems([]);
                    }}
                    className="border-input bg-input min-w-0 flex-1 rounded border px-1.5 py-1 text-xs"
                  >
                    <option value="">Choose source</option>
                    {contextProviders.map((provider) => (
                      <option key={provider.title} value={provider.title}>
                        {provider.displayTitle}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void prepareProvider()}
                    disabled={!providerTitle || loading}
                    className="border-input bg-input hover:bg-list-hover cursor-pointer rounded border px-2 py-1 text-xs disabled:cursor-default disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {selectedProvider?.type !== "submenu" && (
                  <input
                    aria-label="Agent context query"
                    value={providerQuery}
                    onChange={(event) => setProviderQuery(event.target.value)}
                    placeholder="URL, search, or context query"
                    className="border-input bg-input mt-1 box-border w-full rounded border px-2 py-1.5 text-xs outline-none"
                  />
                )}
                {providerItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    title={item.description}
                    onClick={() =>
                      selectedProvider &&
                      void resolveProvider(
                        selectedProvider,
                        item.id,
                        item.title,
                      )
                    }
                    className="hover:bg-list-hover mt-1 block w-full cursor-pointer truncate rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </details>
          )}
          {mcpServers.some((server) => server.prompts.length > 0) && (
            <details className="border-input mb-2 border-b pb-2 text-xs">
              <summary className="text-description cursor-pointer py-1 text-[10px] font-medium uppercase tracking-wide">
                MCP prompts
              </summary>
              {mcpServers.flatMap((server) =>
                server.prompts.map((prompt) => (
                  <button
                    type="button"
                    key={`${server.id}:${prompt.name}`}
                    title={prompt.description}
                    onClick={() => void attachMcpPrompt(server.name, prompt)}
                    className="hover:bg-list-hover block w-full cursor-pointer truncate rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
                  >
                    {server.name} / {prompt.name}
                  </button>
                )),
              )}
            </details>
          )}
          <input
            autoFocus
            aria-label="Search repository files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repository files"
            className="border-input bg-input box-border w-full rounded border px-2 py-1.5 text-xs outline-none"
          />
          <div className="mt-1 max-h-32 overflow-y-auto">
            {loading ? (
              <div className="text-description px-2 py-2 text-xs">
                Searching…
              </div>
            ) : (
              results.map((file) => (
                <button
                  type="button"
                  key={file}
                  title={file}
                  onClick={() => addFile(file)}
                  className="hover:bg-list-hover block w-full cursor-pointer truncate rounded border-none bg-transparent px-2 py-1.5 text-left text-xs"
                >
                  {file}
                </button>
              ))
            )}
            {!loading && results.length === 0 && !message && (
              <div className="text-description px-2 py-2 text-xs">
                No matching repository files.
              </div>
            )}
            {message && (
              <div className="text-warning px-2 py-2 text-xs">{message}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseMultitaskItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function configuredReasoningEffort(model: unknown): string | undefined {
  if (!model || typeof model !== "object" || !("requestOptions" in model)) {
    return undefined;
  }
  const requestOptions = model.requestOptions as
    | { extraBodyProperties?: Record<string, unknown> }
    | undefined;
  const extra = requestOptions?.extraBodyProperties;
  const configured = extra?.reasoning_effort;
  if (typeof configured === "string") return configured;
  const levels = extra?._reasoningLevels;
  if (!Array.isArray(levels)) return undefined;
  if (levels.includes("medium")) return "medium";
  return typeof levels[0] === "string" ? levels[0] : undefined;
}

function workspaceLabel(run: AgentRun): string {
  const value = run.workspace.worktreePath ?? run.workspace.repositoryPath;
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function statusColor(status: AgentRun["status"]): string {
  switch (status) {
    case "running":
      return "bg-success";
    case "queued":
    case "waiting":
      return "bg-info";
    case "attention":
    case "failed":
      return "bg-warning";
    case "canceled":
      return "bg-description-muted";
    default:
      return "bg-description";
  }
}

function agentDepth(run: AgentRun, runs: AgentRun[]): number {
  const byId = new Map(runs.map((candidate) => [candidate.id, candidate]));
  let depth = 0;
  let parentId = run.parentRunId;
  const visited = new Set<string>();
  while (parentId && depth < 8 && !visited.has(parentId)) {
    visited.add(parentId);
    depth++;
    parentId = byId.get(parentId)?.parentRunId;
  }
  return depth;
}

const EVENT_ROW_HEIGHT = 58;
const EVENT_VIEWPORT_HEIGHT = 348;

type ConversationItem =
  | { type: "event"; event: AgentEvent }
  | {
      type: "tool";
      id: string;
      started: AgentEvent;
      finished?: AgentEvent;
      output: AgentEvent[];
    };

type ToolConversationItem = Extract<ConversationItem, { type: "tool" }>;

function eventSummary(event: AgentEvent): string {
  if (typeof event.payload === "string") return event.payload;
  if (event.payload && typeof event.payload === "object") {
    const payload = event.payload as Record<string, unknown>;
    const value =
      payload.text ??
      payload.prompt ??
      payload.message ??
      payload.reason ??
      payload.error ??
      payload.status ??
      payload.to;
    if (typeof value === "string") return value;
  }
  return "";
}

function eventPayload(event: AgentEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function toolKey(event: AgentEvent): string {
  const payload = eventPayload(event);
  if (typeof payload.toolName === "string") return payload.toolName;
  if (payload.scope === "process") return "__agent_process__";
  return "__unscoped__";
}

function toolDisplayName(event: AgentEvent): string {
  const payload = eventPayload(event);
  const raw =
    typeof payload.toolName === "string"
      ? payload.toolName
      : payload.scope === "process"
        ? "Agent process"
        : "Tool";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (character) => character.toUpperCase());
}

function toolContext(event: AgentEvent): string | undefined {
  const args = eventPayload(event).args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const values = args as Record<string, unknown>;
  const preferred = [
    "filepath",
    "path",
    "query",
    "pattern",
    "command",
    "url",
    "symbol",
  ];
  for (const key of preferred) {
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

function groupConversationEvents(events: AgentEvent[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const pending = new Map<string, ToolConversationItem[]>();
  const firstPending = (): [string, ToolConversationItem] | undefined => {
    for (const [key, candidates] of pending) {
      if (candidates[0]) return [key, candidates[0]];
    }
  };
  for (const event of events) {
    if (event.kind === "tool.started") {
      const item: ToolConversationItem = {
        type: "tool",
        id: event.id,
        started: event,
        output: [],
      };
      items.push(item);
      const key = toolKey(event);
      pending.set(key, [...(pending.get(key) ?? []), item]);
      continue;
    }
    if (
      event.kind === "tool.output" ||
      event.kind === "tool.completed" ||
      event.kind === "tool.failed"
    ) {
      let key = toolKey(event);
      let candidates = pending.get(key);
      let item = candidates?.[0];
      if (!item && key === "__unscoped__") {
        const fallback = firstPending();
        key = fallback?.[0] ?? key;
        candidates = pending.get(key);
        item = fallback?.[1];
      }
      if (item && candidates) {
        if (event.kind === "tool.output") {
          item.output.push(event);
        } else {
          item.finished = event;
          candidates.shift();
          if (candidates.length === 0) pending.delete(key);
        }
        continue;
      }
    }
    items.push({ type: "event", event });
  }
  return items;
}

function eventTime(event: AgentEvent): string {
  return new Date(event.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ToolActivityCard({ item }: { item: ToolConversationItem }) {
  const failed = item.finished?.kind === "tool.failed";
  const running = !item.finished;
  const context = toolContext(item.started);
  const outputEvents = [
    ...item.output,
    ...(item.finished ? [item.finished] : []),
  ];
  const output = outputEvents
    .map(eventSummary)
    .filter(Boolean)
    .join("\n")
    .trim();
  const preview = (output || (running ? eventSummary(item.started) : ""))
    .split(/\r?\n/)[0]
    ?.slice(0, 150);
  const args = eventPayload(item.started).args;
  const hasArgs =
    Boolean(args) &&
    typeof args === "object" &&
    !Array.isArray(args) &&
    Object.keys(args as Record<string, unknown>).length > 0;
  const duration = item.finished
    ? Math.max(
        0,
        new Date(item.finished.createdAt).getTime() -
          new Date(item.started.createdAt).getTime(),
      )
    : undefined;
  return (
    <details
      data-testid="agent-event-row"
      data-status={failed ? "failed" : running ? "running" : "completed"}
      className="cursor-tool-activity group min-w-0"
    >
      <summary className="cursor-tool-summary flex min-w-0 cursor-pointer list-none items-center">
        <span className="cursor-tool-icon flex flex-shrink-0 items-center justify-center">
          {failed ? (
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
          ) : running ? (
            <span className="cursor-agent-spinner !h-3.5 !w-3.5" />
          ) : (
            <CheckCircleIcon className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="cursor-tool-main min-w-0 flex-1">
          <span className="cursor-tool-title-row flex min-w-0 items-center">
            <span className="cursor-tool-action flex-shrink-0">
              {toolDisplayName(item.started)}
            </span>
            {context && (
              <span className="cursor-tool-detail min-w-0 truncate">
                {context}
              </span>
            )}
          </span>
          {preview && (
            <span className="cursor-tool-preview block truncate">
              {preview}
            </span>
          )}
        </span>
        <span className="cursor-tool-meta flex flex-shrink-0 items-center">
          {duration !== undefined && duration >= 1000
            ? `${(duration / 1000).toFixed(1)}s`
            : ""}
          <time>{eventTime(item.finished ?? item.started)}</time>
          <ChevronRightIcon className="cursor-tool-chevron h-3 w-3" />
        </span>
      </summary>
      <div className="cursor-tool-output min-w-0 overflow-hidden">
        {hasArgs && (
          <pre className="text-description m-0 overflow-x-auto border-b px-3 py-2 text-[10px] leading-4">
            <code>
              {JSON.stringify(eventPayload(item.started).args, null, 2)}
            </code>
          </pre>
        )}
        <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[11px] leading-4">
          <code>
            {output || (running ? "Waiting for result…" : "Completed")}
          </code>
        </pre>
      </div>
    </details>
  );
}

function ConversationEventCard({
  event,
  onEditAndResend,
}: {
  event: AgentEvent;
  onEditAndResend?: (prompt: string) => void;
}) {
  const summary = eventSummary(event) || `Event ${event.sequence}`;
  if (event.kind === "message.assistant") {
    return (
      <div
        data-testid="agent-event-row"
        className="cursor-assistant-message px-1 py-2 text-xs"
      >
        <StyledMarkdownPreview
          isRenderingInStepContainer
          useParentBackgroundColor
          source={summary}
        />
      </div>
    );
  }
  if (event.kind === "message.reasoning") {
    return (
      <details
        data-testid="agent-event-row"
        className="cursor-reasoning-card px-3 py-2 text-xs"
      >
        <summary className="text-description cursor-pointer select-none text-[11px] font-medium">
          Thought process · {eventTime(event)}
        </summary>
        <div className="text-description mt-2 whitespace-pre-wrap break-words leading-5">
          {summary}
        </div>
      </details>
    );
  }
  if (event.kind === "run.progress" || event.kind === "runtime.notice") {
    return (
      <div
        data-testid="agent-event-row"
        className="cursor-runtime-notice text-description flex items-center gap-2 px-2 py-1 text-[11px]"
      >
        {event.kind === "run.progress" && (
          <span className="cursor-agent-spinner" />
        )}
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        <time className="flex-shrink-0 text-[10px]">{eventTime(event)}</time>
      </div>
    );
  }
  const isUser = event.kind === "message.user";
  return (
    <div
      data-testid="agent-event-row"
      className={`cursor-event-card min-w-0 rounded-lg border px-3 py-2.5 text-xs ${isUser ? "cursor-event-user ml-10" : ""}`}
    >
      <div className="text-description mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide">
        <span>{isUser ? "You" : event.kind.replaceAll(".", " ")}</span>
        <time>{eventTime(event)}</time>
        {isUser && onEditAndResend && (
          <button
            type="button"
            aria-label="Edit and resend message"
            onClick={() => onEditAndResend(summary)}
            className="hover:text-foreground ml-auto cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            Edit
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words leading-5">{summary}</div>
    </div>
  );
}

function eventPresentation(event: AgentEvent): {
  label: string;
  className: string;
} {
  if (event.kind === "message.user") {
    return {
      label: "You",
      className: "border-input bg-input ml-10",
    };
  }
  if (event.kind === "message.assistant") {
    return {
      label: "Agent",
      className: "border-transparent bg-transparent",
    };
  }
  if (event.kind === "message.reasoning") {
    return {
      label: "Thinking",
      className: "border-input bg-editor text-description",
    };
  }
  if (event.kind.startsWith("tool.")) {
    return {
      label: event.kind.replace("tool.", "Tool · "),
      className: "border-input bg-editor",
    };
  }
  return {
    label: event.kind === "run.status" ? "Status" : "Agent runtime",
    className: "border-input bg-editor text-description",
  };
}

function coalesceConversationEvents(
  events: AgentEvent[],
  showLatestProgress: boolean,
): AgentEvent[] {
  const coalesced: AgentEvent[] = [];
  let latestProgress: AgentEvent | undefined;
  for (const event of events) {
    if (event.kind === "run.progress") {
      latestProgress = event;
      continue;
    }
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : undefined;
    const previous = coalesced.at(-1);
    const previousPayload =
      previous?.payload && typeof previous.payload === "object"
        ? (previous.payload as Record<string, unknown>)
        : undefined;
    if (
      event.kind === "message.assistant" &&
      payload?.delta === true &&
      previous?.kind === "message.assistant" &&
      previousPayload?.delta === true
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        payload: {
          ...previousPayload,
          text: `${String(previousPayload.text ?? "")}${String(
            payload.text ?? "",
          )}`,
        },
      };
      continue;
    }
    coalesced.push(event);
  }
  if (showLatestProgress && latestProgress) {
    coalesced.push(latestProgress);
  }
  return coalesced;
}

function VirtualEventList({
  events,
  onEditAndResend,
}: {
  events: AgentEvent[];
  onEditAndResend?: (prompt: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const conversationItems = useMemo(
    () => groupConversationEvents(events),
    [events],
  );
  const start = Math.max(0, Math.floor(scrollTop / EVENT_ROW_HEIGHT) - 3);
  const count = Math.ceil(EVENT_VIEWPORT_HEIGHT / EVENT_ROW_HEIGHT) + 6;
  const visible = events.slice(start, start + count);
  if (events.length === 0) return null;
  if (conversationItems.length <= 600) {
    return (
      <div
        aria-label="Agent conversation"
        className="cursor-conversation-timeline mt-3 space-y-1.5"
      >
        {conversationItems.map((item) =>
          item.type === "tool" ? (
            <ToolActivityCard key={item.id} item={item} />
          ) : (
            <ConversationEventCard
              key={item.event.id}
              event={item.event}
              onEditAndResend={onEditAndResend}
            />
          ),
        )}
      </div>
    );
  }
  return (
    <div
      aria-label="Agent conversation"
      className="min-h-0 overflow-y-auto"
      style={{ height: EVENT_VIEWPORT_HEIGHT }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="relative min-w-0"
        style={{ height: events.length * EVENT_ROW_HEIGHT }}
      >
        {visible.map((event, index) => {
          const position = start + index;
          return (
            <div
              key={event.id}
              data-testid="agent-event-row"
              aria-posinset={position + 1}
              aria-setsize={events.length}
              className="absolute left-0 right-0 min-w-0 px-1 py-1 text-xs"
              style={{
                height: EVENT_ROW_HEIGHT,
                transform: `translateY(${position * EVENT_ROW_HEIGHT}px)`,
              }}
            >
              {(() => {
                const presentation = eventPresentation(event);
                return (
                  <div
                    className={`box-border flex h-full min-w-0 items-start gap-2 rounded-md border px-3 py-2 ${presentation.className}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-2xs mb-0.5 flex items-center gap-2 font-medium">
                        <span>{presentation.label}</span>
                        <time className="text-description font-normal">
                          {new Date(event.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        {event.kind === "message.user" && onEditAndResend && (
                          <button
                            type="button"
                            aria-label="Edit and resend message"
                            onClick={() =>
                              onEditAndResend(
                                eventSummary(event) ||
                                  `Event ${event.sequence}`,
                              )
                            }
                            className="text-description hover:text-foreground ml-auto cursor-pointer border-none bg-transparent p-0"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <div className="truncate leading-5">
                        {eventSummary(event) || `Event ${event.sequence}`}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentPlanCard({
  plan,
  onUpdate,
  onStatus,
  onExport,
}: {
  plan: AgentPlan;
  onUpdate: (title: string, items: AgentPlanItem[]) => void;
  onStatus: (status: AgentPlan["status"]) => void;
  onExport: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(plan.title);
  const [items, setItems] = useState(plan.items);
  const completed = plan.items.filter(
    (item) => item.status === "completed",
  ).length;
  return (
    <div className="border-input bg-editor mt-2 rounded border p-2">
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            aria-label="Plan title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="border-border-focus bg-input min-w-0 flex-1 rounded border px-1 text-xs outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {plan.title}
          </span>
        )}
        <span className="text-description text-2xs flex-shrink-0">
          {completed}/{plan.items.length} · {plan.status}
        </span>
      </div>
      <div className="mt-1 space-y-1">
        {(editing ? items : plan.items).map((item, index) => (
          <div key={item.id} className="flex min-w-0 items-center gap-1">
            {editing ? (
              <>
                <select
                  aria-label={`Status ${item.text}`}
                  value={item.status}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? {
                              ...candidate,
                              status: event.target
                                .value as AgentPlanItem["status"],
                            }
                          : candidate,
                      ),
                    )
                  }
                  className="border-input bg-input text-2xs w-20 rounded border"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">Doing</option>
                  <option value="completed">Done</option>
                </select>
                <input
                  aria-label={`Plan item ${index + 1}`}
                  value={item.text}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, text: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                  className="border-input bg-input min-w-0 flex-1 rounded border px-1 text-xs outline-none"
                />
              </>
            ) : (
              <span className="min-w-0 truncate text-xs">
                {item.status === "completed"
                  ? "✓"
                  : item.status === "in_progress"
                    ? "◐"
                    : "○"}{" "}
                {item.text}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => {
                onUpdate(title, items);
                setEditing(false);
              }}
              className="bg-button text-button-foreground cursor-pointer rounded border-none px-2 py-0.5 text-xs"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitle(plan.title);
              setItems(plan.items);
              setEditing(true);
            }}
            className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
          >
            Edit
          </button>
        )}
        <button
          type="button"
          onClick={() => onStatus("approved")}
          className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onStatus("rejected")}
          className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onExport}
          className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
        >
          Export
        </button>
      </div>
    </div>
  );
}

function AgentRow({
  run,
  selected,
  depth,
  onSelect,
}: {
  run: AgentRun;
  selected: boolean;
  depth: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      data-selected={selected}
      className={`cursor-agent-row focus-visible:border-border-focus flex w-full min-w-0 cursor-pointer items-center gap-2 border px-2 py-2 text-left outline-none transition-colors ${
        selected
          ? "bg-list-active text-list-active-foreground border-accent"
          : "border-transparent bg-transparent"
      }`}
    >
      <span
        className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColor(run.status)} ${
          run.status === "running" ? "animate-pulse" : ""
        }`}
        aria-label={run.status}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-xs ${run.unread ? "font-bold" : "font-medium"}`}
        >
          {run.title}
        </span>
        <span className="text-description text-2xs mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="truncate">{workspaceLabel(run)}</span>
          {run.workspace.branch && (
            <span className="truncate">{run.workspace.branch}</span>
          )}
          {run.parentRunId && <span className="flex-shrink-0">subagent</span>}
          {run.runtimeId && run.runtimeId !== "local" && (
            <span className="flex-shrink-0">{run.runtimeId}</span>
          )}
          {(run.diffAdded || run.diffRemoved) && (
            <span className="flex-shrink-0">
              <span className="text-success">+{run.diffAdded ?? 0}</span>{" "}
              <span className="text-error">-{run.diffRemoved ?? 0}</span>
            </span>
          )}
        </span>
      </span>
      <ChevronRightIcon className="text-description h-3 w-3 flex-shrink-0" />
    </button>
  );
}

function ChatSessionRow({
  session,
  selected,
  onSelect,
}: {
  session: BaseSessionMetadata;
  selected: boolean;
  onSelect: () => void;
}) {
  const workspace = session.workspaceDirectory
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-selected={selected}
      className={`cursor-agent-row focus-visible:border-border-focus group flex w-full min-w-0 cursor-pointer items-center gap-2 border px-2.5 py-2 text-left outline-none transition-colors ${
        selected
          ? "bg-list-active text-list-active-foreground border-accent"
          : "border-transparent bg-transparent"
      }`}
    >
      <ChatBubbleLeftRightIcon className="text-description h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {session.title}
        </span>
        <span className="text-description text-2xs mt-0.5 flex min-w-0 gap-2">
          {workspace && <span className="truncate">{workspace}</span>}
          <span className="flex-shrink-0">
            {session.messageCount ?? 0} messages
          </span>
        </span>
      </span>
      <ChevronRightIcon className="text-description h-3 w-3 flex-shrink-0" />
    </button>
  );
}

function ChatSessionDetails({
  session,
  loading,
  error,
  onOpen,
  onBack,
}: {
  session: BaseSessionMetadata;
  loading: boolean;
  error?: string;
  onOpen: () => void;
  onBack: () => void;
}) {
  const workspace = session.workspaceDirectory
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  const created = new Date(session.dateCreated);
  const formattedDate = Number.isNaN(created.getTime())
    ? undefined
    : created.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });

  return (
    <div className="mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col px-5 py-6 min-[1000px]:px-8 min-[1000px]:py-8">
      <button
        type="button"
        onClick={onBack}
        className="text-description hover:text-foreground mb-5 flex w-fit cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs min-[720px]:hidden"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to sessions
      </button>
      <div className="border-input bg-input min-w-0 rounded-xl border p-5 shadow-sm">
        <div className="bg-list-active mb-4 flex h-10 w-10 items-center justify-center rounded-lg">
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
        </div>
        <div className="text-description text-2xs mb-1 font-medium uppercase tracking-wider">
          Saved chat
        </div>
        <h2 className="m-0 break-words text-lg font-semibold leading-snug">
          {session.title}
        </h2>
        <div className="text-description mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {workspace && <span>{workspace}</span>}
          <span>{session.messageCount ?? 0} messages</span>
          {formattedDate && <span>{formattedDate}</span>}
        </div>
        <div className="border-input text-description mt-4 truncate border-t pt-3 text-xs">
          {session.workspaceDirectory || "No workspace recorded"}
        </div>
        {error && (
          <div
            role="alert"
            className="border-error bg-editor text-error mt-4 rounded-md border px-3 py-2 text-xs"
          >
            Could not open this chat: {error}
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpen}
            disabled={loading}
            className="bg-button text-button-foreground min-w-28 cursor-pointer rounded-md border-none px-3 py-2 text-xs font-medium hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Opening…" : error ? "Retry opening" : "Resume chat"}
          </button>
          <span className="text-description text-2xs self-center">
            Opens in the current chat workspace
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentDetails({
  run,
  childRuns,
  streamMode,
  events,
  queue,
  checkpoints,
  plans,
  onPin,
  onArchive,
  onRunAction,
  onDuplicate,
  onCleanup,
  onCreateSubagent,
  onRename,
  onQueue,
  onUpdateQueueItem,
  onRemoveQueueItem,
  onMoveQueueItem,
  onCreateCheckpoint,
  onRestoreCheckpoint,
  onCreatePlan,
  onUpdatePlan,
  onPlanStatus,
  onExportPlan,
  onCopyRunLink,
  onCopyCheckpointLink,
  onExportRun,
  onToggleRetain,
  onRenameBranch,
  onExportPatch,
  onMergeWorktree,
  onOpenBrowser,
  onPermissionChange,
  onResubmit,
  onSelectRun,
  onClose,
}: {
  run: AgentRun;
  childRuns: AgentRun[];
  streamMode: AgentStreamMode;
  events: AgentEvent[];
  queue: AgentQueueItem[];
  checkpoints: AgentCheckpoint[];
  plans: AgentPlan[];
  onPin: () => void;
  onArchive: () => void;
  onRunAction: () => void;
  onDuplicate: () => void;
  onCleanup: () => void;
  onCreateSubagent: () => void;
  onRename: (title: string) => void;
  onQueue: (prompt: string, behavior: AgentQueueItem["behavior"]) => void;
  onUpdateQueueItem: (
    itemId: string,
    prompt: string,
    behavior: AgentQueueItem["behavior"],
  ) => void;
  onRemoveQueueItem: (itemId: string) => void;
  onMoveQueueItem: (itemId: string, direction: -1 | 1) => void;
  onCreateCheckpoint: () => void;
  onRestoreCheckpoint: (checkpointId: string) => void;
  onCreatePlan: (title: string, items: string[]) => void;
  onUpdatePlan: (
    plan: AgentPlan,
    title: string,
    items: AgentPlanItem[],
  ) => void;
  onPlanStatus: (plan: AgentPlan, status: AgentPlan["status"]) => void;
  onExportPlan: (plan: AgentPlan) => void;
  onCopyRunLink: () => void;
  onCopyCheckpointLink: (checkpointId: string) => void;
  onExportRun: () => void;
  onToggleRetain: () => void;
  onRenameBranch: (branch: string) => void;
  onExportPatch: () => void;
  onMergeWorktree: () => void;
  onOpenBrowser: () => void;
  onPermissionChange: (permissionMode: AgentRun["permissionMode"]) => void;
  onResubmit: (prompt: string) => void;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
}) {
  const [followUp, setFollowUp] = useState("");
  const [queueBehavior, setQueueBehavior] =
    useState<AgentQueueItem["behavior"]>("run-next");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(run.title);
  const [editingQueueId, setEditingQueueId] = useState<string>();
  const [editingQueuePrompt, setEditingQueuePrompt] = useState("");
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [showPlanComposer, setShowPlanComposer] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [planItems, setPlanItems] = useState("");
  const [resubmitSource, setResubmitSource] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState<string>();
  const [contextItems, setContextItems] = useState<AgentContextItem[]>([]);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [showEarlierActivity, setShowEarlierActivity] = useState(false);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const conversationScrollRef = useRef<HTMLElement>(null);
  const followLiveOutputRef = useRef(true);
  const submitFollowUp = () => {
    if (!followUp.trim()) return;
    const prompt = withSkill(
      withContext(followUp.trim(), contextItems),
      selectedSkill,
    );
    if (resubmitSource !== undefined) {
      onResubmit(prompt);
      setResubmitSource(undefined);
    } else {
      onQueue(prompt, queueBehavior);
    }
    setFollowUp("");
    setContextItems([]);
  };
  const beginResubmit = (prompt: string) => {
    setResubmitSource(prompt);
    setFollowUp(prompt);
    window.requestAnimationFrame(() => {
      followUpRef.current?.focus();
      followUpRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  };
  const fullConversationEvents = useMemo(
    () =>
      coalesceConversationEvents(
        events.filter(
          (event) =>
            event.kind.startsWith("message.") ||
            event.kind.startsWith("tool.") ||
            event.kind === "run.progress" ||
            event.kind === "runtime.notice" ||
            event.kind === "review.finding",
        ),
        run.status === "running",
      ),
    [events, run.status],
  );
  const recoveryBoundary = useMemo(() => {
    if (!["completed", "archived"].includes(run.status)) return 0;
    for (let index = fullConversationEvents.length - 1; index >= 0; index--) {
      const event = fullConversationEvents[index];
      if (
        event.kind === "runtime.notice" &&
        eventSummary(event)
          .toLocaleLowerCase()
          .includes("auto-compacted successfully")
      ) {
        return index;
      }
    }
    return 0;
  }, [fullConversationEvents, run.status]);
  const conversationEvents = useMemo(
    () =>
      showEarlierActivity
        ? fullConversationEvents
        : fullConversationEvents.slice(recoveryBoundary),
    [fullConversationEvents, recoveryBoundary, showEarlierActivity],
  );
  const checkpointGroups = useMemo(() => {
    const groups = new Map<string, AgentCheckpoint[]>();
    for (const checkpoint of checkpoints) {
      const label = checkpoint.label?.trim() || "Checkpoint";
      groups.set(label, [...(groups.get(label) ?? []), checkpoint]);
    }
    return [...groups.entries()];
  }, [checkpoints]);
  const promptNeedsCollapse =
    run.prompt.length > 320 || run.prompt.split("\n").length > 8;
  const promptPreview = promptNeedsCollapse
    ? `${run.prompt.slice(0, 320).trimEnd()}…`
    : run.prompt;
  const activitySummary = useMemo(
    () => ({
      toolCalls: events.filter((event) => event.kind === "tool.started").length,
      failures: events.filter((event) => event.kind === "tool.failed").length,
    }),
    [events],
  );
  useEffect(() => {
    const element = conversationScrollRef.current;
    if (!element || !followLiveOutputRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationEvents]);
  useEffect(() => {
    setShowFullPrompt(false);
    setShowEarlierActivity(false);
  }, [run.id]);
  return (
    <div className="cursor-agent-detail cursor-agent-detail-shell mx-auto box-border flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden px-4 py-3 min-[1000px]:px-8 min-[1000px]:py-5">
      <button
        type="button"
        onClick={onClose}
        className="text-description hover:text-foreground mb-4 flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs min-[720px]:hidden"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to agents
      </button>
      <div className="cursor-agent-detail-header flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              aria-label="Agent title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (title.trim() && title.trim() !== run.title) onRename(title);
                setEditingTitle(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setTitle(run.title);
                  setEditingTitle(false);
                }
              }}
              className="border-border-focus bg-editor box-border min-w-0 max-w-full rounded border px-1 py-0 text-sm font-medium outline-none"
            />
          ) : (
            <button
              type="button"
              title="Rename agent"
              className="hover:text-link block max-w-full cursor-text truncate border-none bg-transparent p-0 text-left text-sm font-medium"
              onClick={() => {
                setTitle(run.title);
                setEditingTitle(true);
              }}
            >
              {run.title}
            </button>
          )}
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="cursor-agent-status-pill" data-status={run.status}>
              <span
                className={`cursor-agent-status-dot ${statusColor(run.status)}`}
              />
              {run.status}
            </span>
            <span className="cursor-agent-meta-pill">{run.permissionMode}</span>
            <span className="text-description text-2xs min-w-0 truncate">
              {run.model ?? "Default model"}
            </span>
            {LIVE_AGENT_STATUSES.has(run.status) && (
              <span
                role="status"
                className={`cursor-agent-live-pill ${
                  streamMode === "live"
                    ? "text-success"
                    : streamMode === "polling"
                      ? "text-warning"
                      : "text-description"
                }`}
              >
                {streamMode === "live"
                  ? "● Live"
                  : streamMode === "polling"
                    ? "● Reconnecting"
                    : "● Connecting"}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {!["completed", "archived"].includes(run.status) && (
            <button
              type="button"
              className="hover:bg-list-hover text-2xs cursor-pointer rounded border-none bg-transparent px-1.5 py-1"
              aria-label={
                ["running", "queued", "waiting"].includes(run.status)
                  ? "Cancel agent"
                  : "Resume agent"
              }
              onClick={onRunAction}
            >
              {["running", "queued", "waiting"].includes(run.status)
                ? "Cancel"
                : "Resume"}
            </button>
          )}
          <button
            type="button"
            className="hover:bg-list-hover text-2xs cursor-pointer rounded border-none bg-transparent px-1.5 py-1"
            aria-label={run.pinned ? "Unpin agent" : "Pin agent"}
            onClick={onPin}
          >
            {run.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="hover:bg-list-hover flex cursor-pointer items-center rounded border-none bg-transparent p-1"
            aria-label="Duplicate agent"
            onClick={onDuplicate}
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="hover:bg-list-hover flex cursor-pointer items-center rounded border-none bg-transparent p-1"
            aria-label="Archive agent"
            onClick={onArchive}
          >
            <ArchiveBoxIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="cursor-agent-run-meta text-description text-2xs mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 truncate">{workspaceLabel(run)}</span>
        {run.workspace.branch && (
          <span className="min-w-0 truncate font-mono">
            {run.workspace.branch}
          </span>
        )}
        {activitySummary.toolCalls > 0 && (
          <span>{activitySummary.toolCalls} tool calls</span>
        )}
        {activitySummary.failures > 0 && (
          <span
            className={
              run.status === "completed" ? "text-description" : "text-error"
            }
          >
            {activitySummary.failures}{" "}
            {run.status === "completed" ? "retries" : "failed"}
          </span>
        )}
        {(run.diffAdded || run.diffRemoved) && (
          <span>
            <span className="text-success">+{run.diffAdded ?? 0}</span>{" "}
            <span className="text-error">-{run.diffRemoved ?? 0}</span>
          </span>
        )}
      </div>
      {childRuns.length > 0 && (
        <section
          aria-label="Subagents"
          className="border-input bg-editor mt-2 rounded-lg border p-2"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium">Subagents</span>
            <span className="text-description text-2xs">
              {
                childRuns.filter((child) =>
                  LIVE_AGENT_STATUSES.has(child.status),
                ).length
              }{" "}
              active · {childRuns.length} total
            </span>
          </div>
          <div className="grid gap-1 min-[720px]:grid-cols-2">
            {childRuns.map((child) => (
              <button
                type="button"
                key={child.id}
                aria-label={`Open subagent ${child.title}`}
                onClick={() => onSelectRun(child.id)}
                className="border-input hover:bg-list-hover flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-transparent px-2 py-1.5 text-left"
              >
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColor(child.status)} ${child.status === "running" ? "animate-pulse" : ""}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {child.title}
                  </span>
                  <span className="text-description text-2xs flex min-w-0 gap-1.5">
                    <span className="truncate">{child.status}</span>
                    {child.model && (
                      <span className="truncate">{child.model}</span>
                    )}
                    {(child.diffAdded || child.diffRemoved) && (
                      <span className="flex-shrink-0">
                        <span className="text-success">
                          +{child.diffAdded ?? 0}
                        </span>{" "}
                        <span className="text-error">
                          -{child.diffRemoved ?? 0}
                        </span>
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRightIcon className="text-description h-3 w-3 flex-shrink-0" />
              </button>
            ))}
          </div>
        </section>
      )}
      <details className="relative mt-2 w-fit text-xs">
        <summary
          aria-label="Agent actions"
          className="text-description hover:bg-list-hover flex h-6 w-7 cursor-pointer list-none items-center justify-center rounded-md"
        >
          •••
        </summary>
        <div className="cursor-agent-menu absolute left-0 top-7 z-30 grid w-52 grid-cols-1 gap-0.5 p-1.5">
          <div className="text-description px-2 py-1 text-[11px]">
            {events.length} events · {checkpoints.length} checkpoints ·{" "}
            {plans.length} plans
          </div>
          <button
            type="button"
            onClick={onCopyRunLink}
            className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={onExportRun}
            className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            Export run
          </button>
          {run.workspace.worktreePath && (
            <>
              <button
                type="button"
                onClick={onCreateCheckpoint}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                Create checkpoint
              </button>
              <button
                type="button"
                onClick={onToggleRetain}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                {run.workspace.retained ? "Release worktree" : "Keep worktree"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const branch = window.prompt(
                    "Rename agent branch",
                    run.workspace.branch,
                  );
                  if (branch?.trim()) onRenameBranch(branch.trim());
                }}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                Rename branch
              </button>
              <button
                type="button"
                onClick={onExportPatch}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                Export patch
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Merge this completed agent branch into the current repository branch?",
                    )
                  ) {
                    onMergeWorktree();
                  }
                }}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                Merge
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onCreateSubagent}
            className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            New subagent
          </button>
          <button
            type="button"
            onClick={onOpenBrowser}
            className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            Open browser
          </button>
          <button
            type="button"
            onClick={() => setShowPlanComposer(true)}
            className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
          >
            New plan
          </button>
          {confirmCleanup ? (
            <>
              <button
                type="button"
                onClick={onCleanup}
                className="text-error cursor-pointer border-none bg-transparent p-0"
              >
                Confirm cleanup
              </button>
              <button
                type="button"
                onClick={() => setConfirmCleanup(false)}
                className="hover:text-link cursor-pointer border-none bg-transparent p-0 text-inherit"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCleanup(true)}
              className="hover:text-error cursor-pointer border-none bg-transparent p-0 text-inherit"
            >
              Cleanup
            </button>
          )}
        </div>
      </details>
      {checkpoints.length > 0 && (
        <details className="cursor-checkpoint-menu relative mt-2 text-xs">
          <summary className="border-input hover:bg-list-hover text-description flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border px-2 py-1">
            Checkpoints
            <span className="text-2xs">{checkpoints.length}</span>
          </summary>
          <div className="cursor-checkpoint-popover border-input absolute left-0 top-8 z-30 max-h-72 w-80 max-w-[85vw] overflow-y-auto rounded-lg border p-1.5 shadow-xl">
            {checkpointGroups.map(([label, grouped]) => (
              <div key={label} className="py-1 first:pt-0 last:pb-0">
                <div className="text-description flex items-center justify-between gap-2 px-2 py-1 text-[11px] font-medium">
                  <span className="truncate">{label}</span>
                  {grouped.length > 1 && <span>×{grouped.length}</span>}
                </div>
                {grouped.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="hover:bg-list-hover flex min-w-0 items-center gap-1 rounded px-2 py-1"
                  >
                    <button
                      type="button"
                      onClick={() => onRestoreCheckpoint(checkpoint.id)}
                      aria-label={`Restore checkpoint ${label} ${checkpoint.createdAt}`}
                      className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[11px]"
                    >
                      {new Date(checkpoint.createdAt).toLocaleString()}
                    </button>
                    <button
                      type="button"
                      aria-label={`Copy checkpoint link ${label} ${checkpoint.createdAt}`}
                      onClick={() => onCopyCheckpointLink(checkpoint.id)}
                      className="text-description hover:text-foreground flex-shrink-0 cursor-pointer border-none bg-transparent p-0 text-[10px]"
                    >
                      Copy link
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
      {showPlanComposer && (
        <form
          className="border-input bg-editor mt-2 rounded border p-2"
          onSubmit={(event) => {
            event.preventDefault();
            const items = planItems
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean);
            if (!planTitle.trim() || items.length === 0) return;
            onCreatePlan(planTitle, items);
            setPlanTitle("");
            setPlanItems("");
            setShowPlanComposer(false);
          }}
        >
          <input
            autoFocus
            aria-label="New plan title"
            value={planTitle}
            onChange={(event) => setPlanTitle(event.target.value)}
            placeholder="Plan title"
            className="border-input bg-input box-border w-full rounded border px-1 text-xs outline-none"
          />
          <textarea
            aria-label="New plan items"
            value={planItems}
            onChange={(event) => setPlanItems(event.target.value)}
            placeholder="One step per line"
            rows={3}
            className="border-input bg-input mt-1 box-border w-full resize-none rounded border px-1 text-xs outline-none"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="submit"
              className="bg-button text-button-foreground cursor-pointer rounded border-none px-2 py-0.5 text-xs"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowPlanComposer(false)}
              className="hover:bg-list-hover cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {plans.map((plan) => (
        <AgentPlanCard
          key={plan.id}
          plan={plan}
          onUpdate={(title, items) => onUpdatePlan(plan, title, items)}
          onStatus={(status) => onPlanStatus(plan, status)}
          onExport={() => onExportPlan(plan)}
        />
      ))}
      <section
        ref={conversationScrollRef}
        aria-label="Agent chat"
        className="cursor-agent-transcript mx-auto mt-5 min-h-0 w-full max-w-[840px] flex-1 overflow-y-auto pb-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          followLiveOutputRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            96;
        }}
      >
        <div>
          <div className="cursor-human-message group relative pr-16">
            <div className="whitespace-pre-wrap break-words leading-5">
              {showFullPrompt ? run.prompt : promptPreview}
            </div>
            <button
              type="button"
              aria-label="Edit and resend initial message"
              title="Edit and rerun from this message"
              onClick={() => beginResubmit(run.prompt)}
              className="text-description hover:text-foreground absolute right-2 top-2 flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-[11px] opacity-70 hover:bg-white/5 hover:opacity-100"
            >
              <PencilSquareIcon className="h-3 w-3" /> Edit
            </button>
            {promptNeedsCollapse && (
              <button
                type="button"
                onClick={() => setShowFullPrompt((value) => !value)}
                className="text-description hover:text-foreground mt-2 cursor-pointer border-none bg-transparent p-0 text-[11px]"
              >
                {showFullPrompt ? "Show less" : "Show full task"}
              </button>
            )}
          </div>
          {recoveryBoundary > 0 && !showEarlierActivity && (
            <button
              type="button"
              onClick={() => setShowEarlierActivity(true)}
              className="border-input text-description hover:bg-list-hover mx-auto mt-3 flex cursor-pointer items-center gap-1.5 rounded-full border bg-transparent px-3 py-1 text-[11px]"
            >
              Show earlier activity ({recoveryBoundary})
            </button>
          )}
          {recoveryBoundary > 0 && showEarlierActivity && (
            <button
              type="button"
              onClick={() => setShowEarlierActivity(false)}
              className="text-description hover:text-foreground mx-auto mt-3 block cursor-pointer border-none bg-transparent px-2 py-1 text-[11px]"
            >
              Hide earlier recovery attempts
            </button>
          )}
          {conversationEvents.length > 0 ? (
            <VirtualEventList
              events={conversationEvents}
              onEditAndResend={beginResubmit}
            />
          ) : null}
          {ACTIVE_STATUSES.has(run.status) &&
            conversationEvents.length === 0 && (
              <div
                role="status"
                className="text-description mt-3 flex items-center gap-2 px-1 text-xs"
              >
                <span className="cursor-agent-spinner" />
                <span>
                  {run.status === "waiting"
                    ? "Waiting for your input"
                    : `Working in ${workspaceLabel(run)}…`}
                </span>
              </div>
            )}
        </div>
        {run.statusReason && (
          <div
            role="alert"
            className="border-input bg-editor mt-3 flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5 text-xs"
          >
            <span className="bg-warning mt-1 h-2 w-2 flex-shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Agent stopped</div>
              <div className="text-description mt-0.5 whitespace-pre-wrap break-words">
                {run.statusReason}
              </div>
            </div>
            {!["completed", "archived"].includes(run.status) && (
              <button
                type="button"
                onClick={onRunAction}
                className="border-input bg-input hover:bg-list-hover flex-shrink-0 cursor-pointer rounded-md border px-2 py-1 text-xs"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </section>

      <form
        className="cursor-agent-composer z-10 mx-auto mt-3 min-w-0 flex-shrink-0"
        onSubmit={(event) => {
          event.preventDefault();
          submitFollowUp();
        }}
      >
        {resubmitSource !== undefined && (
          <div className="cursor-resubmit-banner mb-1.5 flex items-center gap-2 rounded-md px-2 py-1 text-[11px]">
            <PencilSquareIcon className="h-3 w-3 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Editing an earlier message creates a new agent branch
            </span>
            <button
              type="button"
              aria-label="Cancel edit and resend"
              onClick={() => {
                setResubmitSource(undefined);
                setFollowUp("");
              }}
              className="hover:text-foreground cursor-pointer border-none bg-transparent p-0 text-inherit"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          ref={followUpRef}
          aria-label="Queue follow-up"
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            resubmitSource === undefined
              ? "Message this agent"
              : "Edit message and rerun"
          }
          rows={2}
          className="cursor-agent-composer-input bg-input box-border w-full resize-none border-none px-1 py-1 text-xs outline-none"
        />
        <div className="cursor-agent-composer-toolbar mt-2 flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <AgentAccessModeSelect
              value={run.permissionMode}
              onChange={onPermissionChange}
            />
            <SkillSelect
              value={selectedSkill}
              onChange={(skill) => setSelectedSkill(skill?.name)}
              compact
            />
            <AgentContextPicker
              repositoryPath={run.workspace.repositoryPath}
              items={contextItems}
              onChange={setContextItems}
            />
            <span
              title={`This run keeps its original model: ${run.model}`}
              className="text-description max-w-40 truncate text-[10px]"
            >
              {run.model}
            </span>
          </div>
          <button
            type="submit"
            aria-label="Send"
            disabled={!followUp.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary-hover flex-shrink-0 cursor-pointer rounded-md border-none px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
      {queue.length > 0 && (
        <div className="mt-2 space-y-1" aria-label="Queued follow-ups">
          {queue.map((item, index) => (
            <div
              key={item.id}
              className="bg-editor flex min-w-0 items-center gap-1 rounded px-2 py-1.5"
            >
              {editingQueueId === item.id ? (
                <input
                  autoFocus
                  aria-label={`Edit ${item.prompt}`}
                  value={editingQueuePrompt}
                  onChange={(event) =>
                    setEditingQueuePrompt(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && editingQueuePrompt.trim()) {
                      onUpdateQueueItem(
                        item.id,
                        editingQueuePrompt,
                        item.behavior,
                      );
                      setEditingQueueId(undefined);
                    }
                    if (event.key === "Escape") setEditingQueueId(undefined);
                  }}
                  className="border-border-focus bg-input min-w-0 flex-1 rounded border px-1 text-xs outline-none"
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Edit ${item.prompt}`}
                  onClick={() => {
                    setEditingQueueId(item.id);
                    setEditingQueuePrompt(item.prompt);
                  }}
                  className="hover:text-link flex min-w-0 flex-1 cursor-text items-center gap-1 truncate border-none bg-transparent p-0 text-left text-xs"
                >
                  <span className="truncate">{item.prompt}</span>
                  <PencilSquareIcon className="h-3 w-3 flex-shrink-0 opacity-60" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Move ${item.prompt} up`}
                disabled={index === 0}
                onClick={() => onMoveQueueItem(item.id, -1)}
                className="hover:bg-list-hover cursor-pointer border-none bg-transparent p-0.5 disabled:opacity-30"
              >
                <ArrowUpIcon className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.prompt} down`}
                disabled={index === queue.length - 1}
                onClick={() => onMoveQueueItem(item.id, 1)}
                className="hover:bg-list-hover cursor-pointer border-none bg-transparent p-0.5 disabled:opacity-30"
              >
                <ArrowDownIcon className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${item.prompt}`}
                onClick={() => onRemoveQueueItem(item.id)}
                className="hover:bg-list-hover cursor-pointer border-none bg-transparent p-0.5"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const dispatch = useAppDispatch();
  const selectedAgentModel = useAppSelector(selectSelectedChatModel);
  const selectedReasoningEffort = useAppSelector((state) =>
    selectedAgentModel?.title
      ? (state.ui.reasoningEffortSettings[selectedAgentModel.title] ??
        configuredReasoningEffort(selectedAgentModel))
      : undefined,
  );
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ideMessenger = useContext(IdeMessengerContext);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [chatSessions, setChatSessions] = useState<BaseSessionMetadata[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [queue, setQueue] = useState<AgentQueueItem[]>([]);
  const [checkpoints, setCheckpoints] = useState<AgentCheckpoint[]>([]);
  const [plans, setPlans] = useState<AgentPlan[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<AgentRuntimeStatus>();
  const [streamMode, setStreamMode] = useState<AgentStreamMode>("idle");
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [openingChatId, setOpeningChatId] = useState<string>();
  const [chatOpenError, setChatOpenError] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showCreate, setShowCreate] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [showMultitask, setShowMultitask] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newRepository, setNewRepository] = useState("");
  const [newRuntime, setNewRuntime] = useState<"local" | "docker" | "ssh">(
    "local",
  );
  const [newContainerImage, setNewContainerImage] = useState(
    "continue-agent:latest",
  );
  const [newSshHost, setNewSshHost] = useState("");
  const [newPermissionMode, setNewPermissionMode] =
    useState<AgentRun["permissionMode"]>("autonomous");
  const [newParentRunId, setNewParentRunId] = useState<string>();
  const [newSkill, setNewSkill] = useState<string>();
  const [newContextItems, setNewContextItems] = useState<AgentContextItem[]>(
    [],
  );
  const [multitaskItems, setMultitaskItems] = useState("");
  const [multitaskSkill, setMultitaskSkill] = useState<string>();
  const [multitaskContextItems, setMultitaskContextItems] = useState<
    AgentContextItem[]
  >([]);
  const [starting, setStarting] = useState(false);
  const [startingMultitask, setStartingMultitask] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const lastEventSequenceRef = useRef(0);
  const eventPollInFlightRef = useRef(false);

  const appendEvents = useCallback((incoming: AgentEvent[]) => {
    if (incoming.length === 0) return;
    lastEventSequenceRef.current = Math.max(
      lastEventSequenceRef.current,
      incoming.at(-1)?.sequence ?? 0,
    );
    setEvents((current) => {
      const known = new Set(current.map((event) => event.sequence));
      return [
        ...current,
        ...incoming.filter((event) => !known.has(event.sequence)),
      ].sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  const loadRuns = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError(undefined);
      const response = await ideMessenger.request("agents/list", {
        includeArchived: false,
        limit: 200,
      });
      if (response.status === "error") {
        setError(response.error);
      } else {
        setRuns(response.content);
      }
      if (showLoading) setLoading(false);
    },
    [ideMessenger],
  );

  const loadChatSessions = useCallback(async () => {
    const response = await ideMessenger.request("history/list", {
      offset: 0,
      limit: 200,
    });
    if (response.status === "error") {
      setError(response.error);
      return;
    }
    setChatSessions(
      [...response.content].sort(
        (a, b) =>
          new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
      ),
    );
  }, [ideMessenger]);

  const loadRuntimeStatus = useCallback(async () => {
    const response = await ideMessenger.request("agents/status", undefined);
    if (response.status === "success") setRuntimeStatus(response.content);
  }, [ideMessenger]);

  useEffect(() => {
    void loadRuns();
    void loadChatSessions();
    void loadRuntimeStatus();
  }, [loadChatSessions, loadRuns, loadRuntimeStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void loadRuntimeStatus();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [loadRuntimeStatus]);

  useEffect(() => {
    const linkedRunId = searchParams.get("runId");
    if (linkedRunId && runs.some((run) => run.id === linkedRunId)) {
      setSelectedId(linkedRunId);
    }
  }, [runs, searchParams]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void loadRuns(false);
    }, 750);
    return () => window.clearInterval(interval);
  }, [loadRuns]);

  useEffect(() => {
    let canceled = false;
    lastEventSequenceRef.current = 0;
    eventPollInFlightRef.current = false;
    if (!selectedId) {
      setEvents([]);
      setQueue([]);
      setCheckpoints([]);
      setPlans([]);
      return;
    }
    void Promise.all([
      ideMessenger.request("agents/events", {
        runId: selectedId,
        options: { limit: 10_000 },
      }),
      ideMessenger.request("agents/queue", { runId: selectedId }),
      ideMessenger.request("agents/checkpoints", { runId: selectedId }),
      ideMessenger.request("agents/plans", { runId: selectedId }),
    ]).then(
      ([eventResponse, queueResponse, checkpointResponse, planResponse]) => {
        if (canceled) return;
        if (eventResponse.status === "success") {
          setEvents(eventResponse.content);
          lastEventSequenceRef.current =
            eventResponse.content.at(-1)?.sequence ?? 0;
        }
        if (queueResponse.status === "success") setQueue(queueResponse.content);
        if (checkpointResponse.status === "success")
          setCheckpoints(checkpointResponse.content);
        if (planResponse.status === "success") setPlans(planResponse.content);
      },
    );
    return () => {
      canceled = true;
    };
  }, [ideMessenger, selectedId]);

  const control = useCallback(
    async (request: AgentControlRequest) => {
      const response = await ideMessenger.request("agents/control", request);
      if (response.status === "error") {
        setError(response.error);
        return false;
      }
      await loadRuns(false);
      return true;
    },
    [ideMessenger, loadRuns],
  );

  const reloadQueue = useCallback(async () => {
    if (!selectedId) return;
    const response = await ideMessenger.request("agents/queue", {
      runId: selectedId,
    });
    if (response.status === "success") setQueue(response.content);
  }, [ideMessenger, selectedId]);

  const reloadPlans = useCallback(async () => {
    if (!selectedId) return;
    const response = await ideMessenger.request("agents/plans", {
      runId: selectedId,
    });
    if (response.status === "success") setPlans(response.content);
  }, [ideMessenger, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let canceled = false;
    const controller = new AbortController();
    let queueTick = 0;
    let fallbackInterval: number | undefined;
    setStreamMode("connecting");

    const pollEvents = () => {
      if (
        document.visibilityState === "hidden" ||
        eventPollInFlightRef.current
      ) {
        return;
      }
      eventPollInFlightRef.current = true;
      void ideMessenger
        .request("agents/events", {
          runId: selectedId,
          options: {
            afterSequence: lastEventSequenceRef.current,
            limit: 1_000,
          },
        })
        .then((response) => {
          if (canceled) return;
          if (response.status !== "success" || response.content.length === 0) {
            return;
          }
          appendEvents(response.content);
        })
        .finally(() => {
          eventPollInFlightRef.current = false;
        });
    };

    const startFallback = () => {
      if (canceled || fallbackInterval !== undefined) return;
      setStreamMode("polling");
      fallbackInterval = window.setInterval(pollEvents, 300);
      pollEvents();
    };

    void (async () => {
      try {
        for await (const chunks of ideMessenger.streamRequest(
          "agents/stream",
          {
            runId: selectedId,
            options: {
              afterSequence: lastEventSequenceRef.current,
              limit: 1_000,
            },
          },
          controller.signal,
        )) {
          if (canceled) return;
          setStreamMode("live");
          appendEvents(chunks);
        }
        if (!canceled) startFallback();
      } catch {
        if (!canceled && !controller.signal.aborted) startFallback();
      }
    })();

    const queueInterval = window.setInterval(() => {
      queueTick++;
      if (queueTick % 2 === 0) {
        void reloadQueue();
        void reloadPlans();
      }
    }, 500);
    return () => {
      canceled = true;
      controller.abort();
      setStreamMode("idle");
      if (fallbackInterval !== undefined) {
        window.clearInterval(fallbackInterval);
      }
      window.clearInterval(queueInterval);
    };
  }, [appendEvents, ideMessenger, reloadPlans, reloadQueue, selectedId]);

  const selectRun = useCallback(
    (run: AgentRun) => {
      setSelectedChatId(undefined);
      setChatOpenError(undefined);
      setSelectedId(run.id);
      if (run.unread) {
        void ideMessenger
          .request("agents/control", {
            action: "unread",
            runId: run.id,
            unread: false,
          })
          .then(() => loadRuns(false));
      }
    },
    [ideMessenger, loadRuns],
  );

  const duplicateRun = useCallback(
    async (run: AgentRun) => {
      const response = await ideMessenger.request("agents/control", {
        action: "run.duplicate",
        runId: run.id,
      });
      if (response.status === "error") {
        setError(response.error);
        return;
      }
      const duplicate = response.content as AgentRun;
      await loadRuns(false);
      setSelectedId(duplicate.id);
    },
    [ideMessenger, loadRuns],
  );

  const resubmitRun = useCallback(
    async (source: AgentRun, prompt: string) => {
      const normalized = prompt.trim();
      if (!normalized) return;
      setError(undefined);
      const response = await ideMessenger.request("agents/control", {
        action: "run.create",
        request: {
          title: source.title,
          prompt: normalized,
          model: source.model,
          subagentModel: source.subagentModel,
          permissionMode: source.permissionMode,
          parentRunId: source.parentRunId,
          runtimeId: source.runtimeId,
          metadata: {
            ...source.metadata,
            branchedFromRunId: source.id,
            branchedAt: new Date().toISOString(),
          },
          workspace: {
            location: source.workspace.location,
            repositoryPath: source.workspace.repositoryPath,
            baseRevision: source.workspace.baseRevision,
          },
        },
      });
      if (response.status === "error") {
        setError(response.error);
        return;
      }
      const branch = response.content as AgentRun;
      await loadRuns(false);
      setSelectedId(branch.id);
    },
    [ideMessenger, loadRuns],
  );

  const cleanupRun = useCallback(
    async (runId: string) => {
      const response = await ideMessenger.request("agents/control", {
        action: "run.cleanup",
        runId,
      });
      if (response.status === "error") {
        setError(response.error);
        return;
      }
      setSelectedId(undefined);
      await loadRuns(false);
    },
    [ideMessenger, loadRuns],
  );

  const openCreate = useCallback(
    async (parentRunId?: string) => {
      setShowMultitask(false);
      setShowCreate(true);
      setNewParentRunId(parentRunId);
      if (newRepository) return;
      const response = await ideMessenger.request(
        "getWorkspaceDirs",
        undefined,
      );
      if (response.status === "success" && response.content[0]) {
        setNewRepository(
          decodeURIComponent(response.content[0].replace(/^file:\/\//, "")),
        );
        return;
      }
      const fallback =
        runs.find((run) => run.id === parentRunId)?.workspace.repositoryPath ??
        runs.find((run) => run.id === selectedId)?.workspace.repositoryPath ??
        runs.find((run) => run.workspace.repositoryPath)?.workspace
          .repositoryPath ??
        chatSessions.find((session) => session.workspaceDirectory)
          ?.workspaceDirectory ??
        window.localStorage.getItem("continue.agents.lastRepository") ??
        "";
      if (fallback) setNewRepository(fallback);
    },
    [chatSessions, ideMessenger, newRepository, runs, selectedId],
  );

  const chooseRepository = useCallback(async () => {
    const response = await ideMessenger.request(
      "agents/selectRepository",
      undefined,
    );
    if (response.status === "success" && response.content) {
      setNewRepository(response.content);
      window.localStorage.setItem(
        "continue.agents.lastRepository",
        response.content,
      );
    }
  }, [ideMessenger]);

  const openMultitask = useCallback(async () => {
    setShowCreate(false);
    setNewParentRunId(undefined);
    setShowMultitask(true);
    if (newRepository) return;
    const response = await ideMessenger.request("getWorkspaceDirs", undefined);
    if (response.status === "success" && response.content[0]) {
      setNewRepository(
        decodeURIComponent(response.content[0].replace(/^file:\/\//, "")),
      );
      return;
    }
    const fallback =
      runs.find((run) => run.id === selectedId)?.workspace.repositoryPath ??
      runs.find((run) => run.workspace.repositoryPath)?.workspace
        .repositoryPath ??
      chatSessions.find((session) => session.workspaceDirectory)
        ?.workspaceDirectory ??
      window.localStorage.getItem("continue.agents.lastRepository") ??
      "";
    if (fallback) setNewRepository(fallback);
  }, [chatSessions, ideMessenger, newRepository, runs, selectedId]);

  const createRun = useCallback(async () => {
    if (!newPrompt.trim() || !newRepository.trim()) return;
    setStarting(true);
    setError(undefined);
    const response = await ideMessenger.request("agents/control", {
      action: "run.create",
      request: {
        prompt: withSkill(
          withContext(newPrompt.trim(), newContextItems),
          newSkill,
        ),
        model: selectedAgentModel?.title,
        permissionMode: newPermissionMode,
        parentRunId: newParentRunId,
        runtimeId: newRuntime,
        metadata: {
          reasoningEffort: selectedReasoningEffort,
          ...(newRuntime === "docker"
            ? {
                container: {
                  image: newContainerImage.trim() || "continue-agent:latest",
                  network: "bridge",
                  privileged: false,
                },
              }
            : newRuntime === "ssh"
              ? {
                  ssh: {
                    host: newSshHost.trim(),
                    remotePath: newRepository.trim(),
                  },
                }
              : {}),
        },
        workspace: {
          location:
            newRuntime === "docker"
              ? "container"
              : newRuntime === "ssh"
                ? "ssh"
                : "local",
          repositoryPath: newRepository.trim(),
        },
      },
    });
    setStarting(false);
    if (response.status === "error") {
      setError(response.error);
      return;
    }
    const run = response.content as AgentRun;
    window.localStorage.setItem(
      "continue.agents.lastRepository",
      newRepository.trim(),
    );
    setShowCreate(false);
    setNewPrompt("");
    setNewContextItems([]);
    setNewParentRunId(undefined);
    await loadRuns();
    setSelectedId(run.id);
  }, [
    ideMessenger,
    loadRuns,
    selectedAgentModel,
    selectedReasoningEffort,
    newPermissionMode,
    newSkill,
    newParentRunId,
    newPrompt,
    newRepository,
    newContextItems,
    newRuntime,
    newContainerImage,
    newSshHost,
  ]);

  const createMultitaskRuns = useCallback(async () => {
    const tasks = parseMultitaskItems(multitaskItems);
    if (
      !tasks.length ||
      !newRepository.trim() ||
      (newRuntime === "ssh" && !newSshHost.trim())
    ) {
      return;
    }
    setStartingMultitask(true);
    setError(undefined);
    const responses = await Promise.all(
      tasks.map((task) =>
        ideMessenger.request("agents/control", {
          action: "run.create",
          request: {
            prompt: withSkill(
              withContext(task, multitaskContextItems),
              multitaskSkill,
            ),
            model: selectedAgentModel?.title,
            permissionMode: newPermissionMode,
            runtimeId: newRuntime,
            metadata: {
              reasoningEffort: selectedReasoningEffort,
              ...(newRuntime === "docker"
                ? {
                    container: {
                      image:
                        newContainerImage.trim() || "continue-agent:latest",
                      network: "bridge",
                      privileged: false,
                    },
                  }
                : newRuntime === "ssh"
                  ? {
                      ssh: {
                        host: newSshHost.trim(),
                        remotePath: newRepository.trim(),
                      },
                    }
                  : {}),
            },
            workspace: {
              location:
                newRuntime === "docker"
                  ? "container"
                  : newRuntime === "ssh"
                    ? "ssh"
                    : "local",
              repositoryPath: newRepository.trim(),
            },
          },
        }),
      ),
    );
    setStartingMultitask(false);
    const failures = responses.filter(
      (response) => response.status === "error",
    );
    if (failures.length) {
      setError(
        `${failures.length} of ${responses.length} tasks could not start`,
      );
    }
    if (responses.some((response) => response.status === "success")) {
      window.localStorage.setItem(
        "continue.agents.lastRepository",
        newRepository.trim(),
      );
      setShowMultitask(false);
      setMultitaskItems("");
      await loadRuns(false);
    }
  }, [
    ideMessenger,
    loadRuns,
    multitaskItems,
    multitaskContextItems,
    multitaskSkill,
    newContainerImage,
    newPermissionMode,
    newRepository,
    newRuntime,
    newSshHost,
    selectedAgentModel,
    selectedReasoningEffort,
  ]);

  const exportRun = useCallback(
    async (run: AgentRun) => {
      const response = await ideMessenger.request("agents/export", {
        runId: run.id,
      });
      if (response.status === "error") {
        setError(response.error);
        return;
      }
      const blob = new Blob([JSON.stringify(response.content, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `continue-agent-${run.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [ideMessenger],
  );

  const exportWorktreePatch = useCallback(
    async (run: AgentRun) => {
      const response = await ideMessenger.request("agents/control", {
        action: "worktree.export",
        runId: run.id,
      });
      if (response.status === "error") {
        setError(response.error);
        return;
      }
      const result = response.content as AgentWorktreeResult;
      const blob = new Blob([result.patch ?? ""], { type: "text/x-diff" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `continue-agent-${run.id}.patch`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [ideMessenger],
  );

  const importRun = useCallback(
    async (file: File) => {
      try {
        const snapshot = JSON.parse(await file.text()) as AgentRunSnapshot;
        const response = await ideMessenger.request("agents/import", {
          snapshot,
        });
        if (response.status === "error") throw new Error(response.error);
        await loadRuns(false);
        setSelectedId(response.content.id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [ideMessenger, loadRuns],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? runs.filter((run) =>
          [
            run.title,
            run.prompt,
            run.workspace.repositoryPath,
            run.workspace.branch,
          ]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(normalized)),
        )
      : runs;
  }, [query, runs]);
  const filteredChatSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? chatSessions.filter((session) =>
          [session.title, session.workspaceDirectory]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalized)),
        )
      : chatSessions;
  }, [chatSessions, query]);
  const repositoryChoices = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...runs.map((run) => run.workspace.repositoryPath),
            ...chatSessions.map((session) => session.workspaceDirectory),
          ].filter((repository): repository is string => Boolean(repository)),
        ),
      ).slice(0, 8),
    [chatSessions, runs],
  );
  const multitaskTaskCount = useMemo(
    () => parseMultitaskItems(multitaskItems).length,
    [multitaskItems],
  );
  const active = filtered.filter((run) => ACTIVE_STATUSES.has(run.status));
  const recent = filtered.filter((run) => !ACTIVE_STATUSES.has(run.status));
  const selected = filtered.find((run) => run.id === selectedId);
  const selectedChat = chatSessions.find(
    (session) => session.sessionId === selectedChatId,
  );

  const openChatSession = useCallback(
    async (sessionId: string) => {
      setOpeningChatId(sessionId);
      setChatOpenError(undefined);
      try {
        try {
          const handoff = await withTimeout(
            ideMessenger.request("session/openInMain", { sessionId }),
            1_500,
          );
          if (handoff.status === "success" && handoff.content) return;
        } catch {
          // IDEs without a native host handoff use the in-webview fallback.
        }
        await dispatch(exitEdit({})).unwrap();
        await withTimeout(
          dispatch(
            loadSession({ sessionId, saveCurrentSession: false }),
          ).unwrap(),
          CHAT_OPEN_TIMEOUT_MS,
        );
        navigate(ROUTES.HOME);
      } catch (cause) {
        setChatOpenError(readableError(cause));
      } finally {
        setOpeningChatId(undefined);
      }
    },
    [dispatch, ideMessenger, navigate],
  );

  const onWorkspaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      void openCreate(undefined);
      return;
    }
    if (event.key === "Escape") {
      setShowCreate(false);
      setShowMultitask(false);
      setSelectedId(undefined);
      setSelectedChatId(undefined);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (filtered.length === 0) return;
    const current = filtered.findIndex((run) => run.id === selectedId);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0
        ? direction > 0
          ? 0
          : filtered.length - 1
        : (current + direction + filtered.length) % filtered.length;
    selectRun(filtered[next]);
  };

  return (
    <div
      aria-label="Agents workspace"
      data-testid="agents-workspace"
      tabIndex={0}
      onKeyDown={onWorkspaceKeyDown}
      className="continue-agents-cursor relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
    >
      <header className="cursor-agents-toolbar flex flex-shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          aria-label="Back to chat"
          onClick={() => {
            if ((window as any).isFullScreen) {
              ideMessenger.post("closeAgentWindow", undefined);
              return;
            }
            navigate(ROUTES.HOME, { replace: true });
            void dispatch(
              saveCurrentSession({
                openNewSession: false,
                generateTitle: true,
              }),
            );
          }}
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          Agent workspace
        </div>
        <div
          role="status"
          aria-label="Agent runtime status"
          title={runtimeStatus?.message ?? "Local agent runtime is ready"}
          className={`text-2xs hidden items-center gap-1.5 min-[720px]:flex ${
            runtimeStatus?.state === "unavailable"
              ? "text-error"
              : runtimeStatus?.state === "ready"
                ? "text-success"
                : "text-description"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              runtimeStatus?.state === "unavailable"
                ? "bg-error"
                : runtimeStatus?.state === "ready"
                  ? "bg-success"
                  : "bg-description-muted animate-pulse"
            }`}
          />
          {runtimeStatus?.state === "unavailable"
            ? "Runtime offline"
            : runtimeStatus?.state === "ready"
              ? "Runtime ready"
              : "Starting runtime"}
        </div>
        <button
          type="button"
          aria-label="New local agent"
          onClick={() => void openCreate(undefined)}
          className="bg-button text-button-foreground flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border-none px-2.5 text-xs font-medium hover:brightness-110"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          <span className="hidden min-[420px]:inline">New agent</span>
        </button>
        <button
          type="button"
          aria-label="Start multiple agents"
          title="Start several local tasks in parallel"
          onClick={() => void openMultitask()}
          className="border-input hover:bg-list-hover flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border bg-transparent px-2 text-xs"
        >
          <Squares2X2Icon className="h-3.5 w-3.5" />
          <span className="hidden min-[620px]:inline">Multitask</span>
        </button>
        <button
          type="button"
          aria-label="Agent automations"
          title="Local agent automations"
          onClick={() => setShowAutomations(true)}
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <ClockIcon className="h-3.5 w-3.5" />
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Import agent snapshot file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importRun(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Import agent snapshot"
          title="Import agent snapshot"
          onClick={() => importRef.current?.click()}
          className="border-input hover:bg-list-hover hidden h-7 cursor-pointer items-center justify-center rounded-md border bg-transparent px-2 text-xs min-[520px]:flex"
        >
          Import
        </button>
        <button
          type="button"
          aria-label="Refresh agents"
          onClick={() => {
            void loadRuns();
            void loadChatSessions();
          }}
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <ArrowPathIcon
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
        {Boolean((window as any).isFullScreen) && (
          <button
            type="button"
            aria-label="Reload Agents window"
            title="Reload Agents window and release any active edit"
            onClick={() => ideMessenger.post("reloadAgentWindow", undefined)}
            className="hover:bg-list-hover focus-visible:ring-border-focus relative z-20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs outline-none focus-visible:ring-1"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            <span className="hidden min-[520px]:inline">Reload</span>
          </button>
        )}
        <button
          type="button"
          aria-label="Open Agents Window"
          onClick={() =>
            void ideMessenger.request("toggleFullScreen", {
              newWindow: true,
              path: ROUTES.AGENTS,
            })
          }
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
        </button>
      </header>

      {showAutomations && (
        <AgentAutomationsPanel
          defaultRepository={newRepository}
          onClose={() => setShowAutomations(false)}
          onRunStarted={() => void loadRuns(false)}
        />
      )}

      {showMultitask && (
        <form
          aria-label="Start multiple agents"
          onSubmit={(event) => {
            event.preventDefault();
            void createMultitaskRuns();
          }}
          className="cursor-agent-launch-overlay bg-background absolute bottom-0 right-0 z-[60] box-border overflow-y-auto border-l p-5"
        >
          <div className="cursor-agent-launch-card mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-base font-semibold">Multitask</h2>
                <p className="text-description mb-0 mt-1 text-xs">
                  Give each agent one outcome per line. Tasks run in parallel,
                  keep separate conversations, and can be canceled
                  independently.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close multitask"
                onClick={() => setShowMultitask(false)}
                className="hover:bg-list-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
            <textarea
              autoFocus
              aria-label="Multitask items"
              value={multitaskItems}
              onChange={(event) => setMultitaskItems(event.target.value)}
              placeholder={
                "Review authentication\nRun and fix failing tests\nAudit responsive UI"
              }
              rows={8}
              className="cursor-agent-launch-textarea border-input bg-editor focus:border-border-focus box-border w-full resize-y rounded-xl border p-4 text-sm leading-relaxed outline-none"
            />
            <div className="mt-3 flex min-w-0 items-center gap-2">
              <input
                aria-label="Multitask repository"
                value={newRepository}
                list="multitask-repository-options"
                onChange={(event) => setNewRepository(event.target.value)}
                placeholder="Choose a repository"
                className="border-input bg-editor focus:border-border-focus box-border min-w-0 flex-1 rounded-md border px-3 py-2 text-xs outline-none"
              />
              <datalist id="multitask-repository-options">
                {repositoryChoices.map((repository) => (
                  <option key={repository} value={repository} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => void chooseRepository()}
                className="border-input bg-input hover:bg-list-hover flex-shrink-0 cursor-pointer rounded-md border px-3 py-2 text-xs"
              >
                Browse…
              </button>
            </div>
            {repositoryChoices.length > 0 && !newRepository && (
              <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                {repositoryChoices.slice(0, 3).map((repository) => (
                  <button
                    key={repository}
                    type="button"
                    title={repository}
                    onClick={() => setNewRepository(repository)}
                    className="border-input bg-input hover:bg-list-hover text-2xs max-w-52 cursor-pointer truncate rounded-full border px-2 py-1"
                  >
                    {repository.split(/[\\/]/).filter(Boolean).at(-1)}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3">
              <AgentContextPicker
                repositoryPath={newRepository}
                items={multitaskContextItems}
                onChange={setMultitaskContextItems}
              />
              <div className="text-description text-2xs mt-1">
                Context files are referenced in every task and resolved inside
                each agent workspace.
              </div>
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[520px]:grid-cols-2">
              <select
                aria-label="Multitask runtime"
                value={newRuntime}
                onChange={(event) =>
                  setNewRuntime(
                    event.target.value as "local" | "docker" | "ssh",
                  )
                }
                className="border-input bg-editor min-w-0 rounded-md border px-2 py-2 text-xs"
              >
                <option value="local">Local</option>
                <option value="docker">Docker</option>
                <option value="ssh">Remote SSH</option>
              </select>
              <select
                aria-label="Multitask permission mode"
                value={newPermissionMode}
                onChange={(event) =>
                  setNewPermissionMode(
                    event.target.value as AgentRun["permissionMode"],
                  )
                }
                className="border-input bg-editor min-w-0 rounded-md border px-2 py-2 text-xs"
              >
                <option value="autonomous">Autonomous</option>
                <option value="ask">Ask</option>
                <option value="fullAccess">Full access</option>
                <option value="readOnly">Read only</option>
              </select>
              <SkillSelect
                value={multitaskSkill}
                onChange={(skill) => setMultitaskSkill(skill?.name)}
                className="border-input bg-editor rounded-md border px-3 py-2"
              />
              <div
                aria-label="Multitask model and reasoning"
                className="border-input bg-editor flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <ModelSelect />
                <ReasoningEffortSelect />
              </div>
              {newRuntime === "docker" && (
                <input
                  aria-label="Multitask container image"
                  value={newContainerImage}
                  onChange={(event) => setNewContainerImage(event.target.value)}
                  placeholder="Container image"
                  className="border-input bg-editor min-w-0 rounded-md border px-3 py-2 text-xs outline-none min-[520px]:col-span-2"
                />
              )}
              {newRuntime === "ssh" && (
                <input
                  aria-label="Multitask SSH host"
                  value={newSshHost}
                  onChange={(event) => setNewSshHost(event.target.value)}
                  placeholder="user@host"
                  className="border-input bg-editor min-w-0 rounded-md border px-3 py-2 text-xs outline-none min-[520px]:col-span-2"
                />
              )}
              <div className="text-description text-2xs min-[520px]:col-span-2">
                {multitaskSkill
                  ? `${multitaskSkill} will be loaded into every task. `
                  : "Skills are optional and apply to every task. "}
                Up to 12 agents are created; 4 run concurrently by default.
              </div>
              <button
                type="button"
                onClick={() => setShowMultitask(false)}
                className="border-input bg-input hover:bg-list-hover cursor-pointer rounded-md border px-3 py-2 text-xs min-[520px]:col-start-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                aria-label="Start tasks"
                disabled={
                  startingMultitask ||
                  multitaskTaskCount === 0 ||
                  !newRepository.trim() ||
                  (newRuntime === "ssh" && !newSshHost.trim())
                }
                className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer rounded-md border-none px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingMultitask
                  ? "Starting…"
                  : multitaskTaskCount === 0
                    ? "Start tasks"
                    : `Start ${multitaskTaskCount} task${
                        multitaskTaskCount === 1 ? "" : "s"
                      }`}
              </button>
              <div className="text-description text-2xs text-right min-[520px]:col-span-2">
                {multitaskTaskCount === 0
                  ? "Add one task per line to enable Start."
                  : !newRepository.trim()
                    ? "Choose a repository to enable Start."
                    : newRuntime === "ssh" && !newSshHost.trim()
                      ? "Enter an SSH host to enable Start."
                      : `Ready to start ${multitaskTaskCount} independent agent${
                          multitaskTaskCount === 1 ? "" : "s"
                        }.`}
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="cursor-agent-shell-grid grid min-h-0 min-w-0 flex-1 grid-cols-1">
        <aside
          aria-label="Agents and chats"
          className={`cursor-agents-sidebar flex min-h-0 min-w-0 flex-col border-r ${
            selected || selectedChat ? "max-[719px]:hidden" : ""
          }`}
        >
          {showCreate && (
            <form
              aria-label="Create agent"
              className="cursor-agent-launch-overlay bg-background absolute bottom-0 right-0 z-50 box-border overflow-y-auto border-l p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void createRun();
              }}
            >
              <div className="cursor-agent-launch-card mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-base font-semibold">New agent</h2>
                    <p className="text-description mb-0 mt-1 text-xs">
                      Describe the outcome. Continue runs it in an isolated
                      local workspace and keeps the conversation here.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close create agent"
                    onClick={() => {
                      setShowCreate(false);
                      setNewParentRunId(undefined);
                    }}
                    className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  aria-label="Agent task"
                  value={newPrompt}
                  onChange={(event) => setNewPrompt(event.target.value)}
                  placeholder="What should the agent build?"
                  rows={7}
                  className="cursor-agent-launch-textarea border-input bg-editor focus:border-border-focus box-border w-full resize-y rounded-xl border p-4 text-sm leading-relaxed outline-none"
                />
                {newParentRunId && (
                  <div className="text-description text-2xs mt-1 truncate">
                    Subagent of{" "}
                    {runs.find((run) => run.id === newParentRunId)?.title}
                  </div>
                )}
                <div className="mt-3 flex min-w-0 items-center gap-2">
                  <input
                    aria-label="Agent repository"
                    value={newRepository}
                    list="agent-repository-options"
                    onChange={(event) => setNewRepository(event.target.value)}
                    placeholder="Choose a repository"
                    className="border-input bg-editor focus:border-border-focus box-border min-w-0 flex-1 rounded-md border px-3 py-2 text-xs outline-none"
                  />
                  <datalist id="agent-repository-options">
                    {repositoryChoices.map((repository) => (
                      <option key={repository} value={repository} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => void chooseRepository()}
                    className="border-input bg-input hover:bg-list-hover flex-shrink-0 cursor-pointer rounded-md border px-3 py-2 text-xs"
                  >
                    Browse…
                  </button>
                </div>
                {repositoryChoices.length > 0 && !newRepository && (
                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                    {repositoryChoices.slice(0, 3).map((repository) => (
                      <button
                        key={repository}
                        type="button"
                        title={repository}
                        onClick={() => setNewRepository(repository)}
                        className="border-input bg-input hover:bg-list-hover text-2xs max-w-52 cursor-pointer truncate rounded-full border px-2 py-1"
                      >
                        {repository.split(/[\\/]/).filter(Boolean).at(-1)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <AgentContextPicker
                    repositoryPath={newRepository}
                    items={newContextItems}
                    onChange={setNewContextItems}
                  />
                  <div className="text-description text-2xs mt-1">
                    Context is stored as portable repository-relative file
                    references, so it works in worktrees and remote runtimes.
                  </div>
                </div>
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[520px]:grid-cols-3">
                  <select
                    aria-label="Agent runtime"
                    value={newRuntime}
                    onChange={(event) =>
                      setNewRuntime(
                        event.target.value as "local" | "docker" | "ssh",
                      )
                    }
                    className="border-input bg-editor min-w-0 rounded-md border px-2 py-2 text-xs"
                  >
                    <option value="local">Local</option>
                    <option value="docker">Docker</option>
                    <option value="ssh">Remote SSH</option>
                  </select>
                  <select
                    aria-label="Agent permission mode"
                    value={newPermissionMode}
                    onChange={(event) =>
                      setNewPermissionMode(
                        event.target.value as AgentRun["permissionMode"],
                      )
                    }
                    className="border-input bg-editor min-w-0 rounded-md border px-2 py-2 text-xs"
                  >
                    <option value="autonomous">Autonomous</option>
                    <option value="ask">Ask</option>
                    <option value="fullAccess">Full access</option>
                    <option value="readOnly">Read only</option>
                  </select>
                  <div
                    aria-label="Agent model and reasoning"
                    className="border-input bg-editor flex min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    <ModelSelect />
                    <ReasoningEffortSelect />
                  </div>
                  <SkillSelect
                    value={newSkill}
                    onChange={(skill) => setNewSkill(skill?.name)}
                    className="border-input bg-editor rounded-md border px-3 py-2 min-[520px]:col-span-3"
                  />
                  <div className="text-description text-2xs min-[520px]:col-span-3">
                    {newSkill
                      ? `${newSkill} will be loaded into this agent with its provenance and supporting files.`
                      : "Skills are optional. Select one to add its instructions and supporting files to this run."}
                  </div>
                  {newRuntime === "docker" && (
                    <input
                      aria-label="Container image"
                      value={newContainerImage}
                      onChange={(event) =>
                        setNewContainerImage(event.target.value)
                      }
                      placeholder="Container image"
                      className="border-input bg-editor min-w-0 rounded-md border px-3 py-2 text-xs outline-none min-[520px]:col-span-3"
                    />
                  )}
                  {newRuntime === "ssh" && (
                    <input
                      aria-label="SSH host"
                      value={newSshHost}
                      onChange={(event) => setNewSshHost(event.target.value)}
                      placeholder="user@host"
                      className="border-input bg-editor min-w-0 rounded-md border px-3 py-2 text-xs outline-none min-[520px]:col-span-3"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false);
                      setNewParentRunId(undefined);
                    }}
                    className="border-input bg-input hover:bg-list-hover cursor-pointer rounded-md border px-3 py-2 text-xs min-[520px]:col-start-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      starting ||
                      !newPrompt.trim() ||
                      !newRepository.trim() ||
                      (newRuntime === "ssh" && !newSshHost.trim())
                    }
                    className="bg-primary text-primary-foreground hover:bg-primary-hover cursor-pointer rounded-md border-none px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {starting ? "Starting…" : "Start"}
                  </button>
                  <div className="text-description text-2xs text-right min-[520px]:col-span-3">
                    {!newPrompt.trim()
                      ? "Describe a task to enable Start."
                      : !newRepository.trim()
                        ? "Choose a repository to enable Start."
                        : newRuntime === "ssh" && !newSshHost.trim()
                          ? "Enter an SSH host to enable Start."
                          : "Ready to start. Enter submits; Escape returns to the agent list."}
                  </div>
                </div>
              </div>
            </form>
          )}

          <div className="cursor-agent-sidebar-search relative mx-3 mt-3 flex-shrink-0">
            <MagnifyingGlassIcon className="text-description pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              ref={searchRef}
              aria-label="Search agents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents and chats"
              className="border-input bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus box-border w-full rounded-md border py-2 pl-7 pr-2 text-xs outline-none"
            />
          </div>

          <div className="cursor-agent-sidebar-sections no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-3">
            {selectedId &&
              (searchParams.get("eventSequence") ||
                searchParams.get("checkpointId")) && (
                <div
                  aria-label="AI attribution origin"
                  className="border-info bg-editor text-info text-2xs mb-2 min-w-0 rounded border px-2 py-1"
                >
                  Attribution origin
                  {searchParams.get("eventSequence")
                    ? ` · event #${searchParams.get("eventSequence")}`
                    : ""}
                  {searchParams.get("checkpointId")
                    ? ` · checkpoint ${searchParams.get("checkpointId")}`
                    : ""}
                </div>
              )}
            {loading && (
              <div aria-label="Loading agents" className="space-y-1 px-1 py-1">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="bg-input h-11 animate-pulse rounded-md opacity-70"
                  />
                ))}
              </div>
            )}
            {error && (
              <div className="border-error text-error rounded-md border p-2 text-xs">
                {error}
              </div>
            )}
            {runtimeStatus?.state === "unavailable" && !error && (
              <div
                role="alert"
                className="border-warning bg-editor text-warning mx-1 mb-2 rounded-md border p-2 text-xs"
              >
                <div className="font-medium">Agent runtime unavailable</div>
                <div className="text-description text-2xs mt-1 break-words">
                  {runtimeStatus.message}
                </div>
                <button
                  type="button"
                  onClick={() => void loadRuntimeStatus()}
                  className="border-input hover:bg-list-hover text-2xs mt-2 cursor-pointer rounded border bg-transparent px-2 py-1"
                >
                  Retry connection
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              filtered.length === 0 &&
              filteredChatSessions.length === 0 && (
                <div className="px-4 py-12 text-center text-xs">
                  <div className="text-description">
                    {query
                      ? "No agents or chats match this search."
                      : "No agent runs or chat sessions yet."}
                  </div>
                  {!query && (
                    <div className="mt-3 flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openCreate(undefined)}
                        className="bg-button text-button-foreground rounded border-none px-3 py-1.5 text-xs"
                      >
                        Start an agent
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(ROUTES.HOME)}
                        className="border-input bg-input hover:bg-list-hover rounded border px-3 py-1.5 text-xs"
                      >
                        Open chat
                      </button>
                    </div>
                  )}
                </div>
              )}
            {active.length > 0 && (
              <section className="cursor-agent-sidebar-section mb-3">
                <div className="cursor-agent-sidebar-section-title text-description text-2xs px-2 pb-1 font-medium uppercase tracking-wide">
                  Active
                </div>
                {active.map((run) => (
                  <AgentRow
                    key={run.id}
                    run={run}
                    selected={selectedId === run.id}
                    depth={agentDepth(run, runs)}
                    onSelect={() => selectRun(run)}
                  />
                ))}
              </section>
            )}
            {recent.length > 0 && (
              <section className="cursor-agent-sidebar-section">
                <div className="cursor-agent-sidebar-section-title text-description text-2xs px-2 pb-1 font-medium uppercase tracking-wide">
                  Recent
                </div>
                {recent.map((run) => (
                  <AgentRow
                    key={run.id}
                    run={run}
                    selected={selectedId === run.id}
                    depth={agentDepth(run, runs)}
                    onSelect={() => selectRun(run)}
                  />
                ))}
              </section>
            )}
            {filteredChatSessions.length > 0 && (
              <section className="cursor-agent-sidebar-section mt-3">
                <div className="cursor-agent-sidebar-section-title text-description text-2xs px-2 pb-1 font-medium uppercase tracking-wide">
                  Chats
                </div>
                {filteredChatSessions.map((session) => (
                  <ChatSessionRow
                    key={session.sessionId}
                    session={session}
                    selected={selectedChatId === session.sessionId}
                    onSelect={() => {
                      setSelectedId(undefined);
                      setSelectedChatId(session.sessionId);
                      setChatOpenError(undefined);
                      void openChatSession(session.sessionId);
                    }}
                  />
                ))}
              </section>
            )}
          </div>
        </aside>
        <main
          aria-label="Agent workspace details"
          className={`cursor-agents-main min-h-0 min-w-0 overflow-hidden ${
            !selected && !selectedChat ? "max-[719px]:hidden" : ""
          }`}
        >
          {selected && (
            <AgentDetails
              run={selected}
              childRuns={runs.filter(
                (candidate) => candidate.parentRunId === selected.id,
              )}
              streamMode={streamMode}
              events={events}
              queue={queue}
              checkpoints={checkpoints}
              plans={plans}
              onPin={() =>
                void control({
                  action: "pin",
                  runId: selected.id,
                  pinned: !selected.pinned,
                })
              }
              onArchive={() =>
                void control({ action: "archive", runId: selected.id }).then(
                  (success) => success && setSelectedId(undefined),
                )
              }
              onRunAction={() =>
                void control(
                  ["running", "queued", "waiting"].includes(selected.status)
                    ? {
                        action: "run.cancel",
                        runId: selected.id,
                        reason: "user-canceled",
                      }
                    : { action: "run.resume", runId: selected.id },
                )
              }
              onDuplicate={() => void duplicateRun(selected)}
              onCleanup={() => void cleanupRun(selected.id)}
              onCreateSubagent={() => void openCreate(selected.id)}
              onRename={(title) =>
                void control({ action: "rename", runId: selected.id, title })
              }
              onQueue={(prompt, behavior) =>
                void control({
                  action: "queue.add",
                  runId: selected.id,
                  prompt,
                  behavior,
                }).then(reloadQueue)
              }
              onUpdateQueueItem={(itemId, prompt, behavior) =>
                void control({
                  action: "queue.update",
                  runId: selected.id,
                  itemId,
                  prompt,
                  behavior,
                }).then(reloadQueue)
              }
              onRemoveQueueItem={(itemId) =>
                void control({
                  action: "queue.remove",
                  runId: selected.id,
                  itemId,
                }).then(reloadQueue)
              }
              onMoveQueueItem={(itemId, direction) => {
                const index = queue.findIndex((item) => item.id === itemId);
                const target = index + direction;
                if (index < 0 || target < 0 || target >= queue.length) return;
                const itemIds = queue.map((item) => item.id);
                [itemIds[index], itemIds[target]] = [
                  itemIds[target],
                  itemIds[index],
                ];
                void control({
                  action: "queue.reorder",
                  runId: selected.id,
                  itemIds,
                }).then(reloadQueue);
              }}
              onCreateCheckpoint={() =>
                void control({
                  action: "checkpoint.create",
                  runId: selected.id,
                  label: `Manual ${new Date().toLocaleTimeString()}`,
                }).then(async () => {
                  const response = await ideMessenger.request(
                    "agents/checkpoints",
                    { runId: selected.id },
                  );
                  if (response.status === "success")
                    setCheckpoints(response.content);
                })
              }
              onRestoreCheckpoint={(checkpointId) =>
                void control({
                  action: "checkpoint.restore",
                  runId: selected.id,
                  checkpointId,
                })
              }
              onCreatePlan={(title, items) =>
                void control({
                  action: "plan.create",
                  runId: selected.id,
                  title,
                  items,
                }).then(reloadPlans)
              }
              onUpdatePlan={(plan, title, items) =>
                void control({
                  action: "plan.update",
                  runId: selected.id,
                  planId: plan.id,
                  title,
                  items,
                  expectedRevision: plan.revision,
                }).then(reloadPlans)
              }
              onPlanStatus={(plan, status) =>
                void control({
                  action: "plan.status",
                  runId: selected.id,
                  planId: plan.id,
                  status,
                  expectedRevision: plan.revision,
                }).then(reloadPlans)
              }
              onExportPlan={(plan) =>
                void ideMessenger.request("copyText", {
                  text: JSON.stringify(plan, null, 2),
                })
              }
              onCopyRunLink={() =>
                void ideMessenger.request("copyText", {
                  text: formatContinueDeepLink({
                    type: "agent",
                    runId: selected.id,
                  }),
                })
              }
              onCopyCheckpointLink={(checkpointId) =>
                void ideMessenger.request("copyText", {
                  text: formatContinueDeepLink({
                    type: "checkpoint",
                    runId: selected.id,
                    checkpointId,
                  }),
                })
              }
              onExportRun={() => void exportRun(selected)}
              onToggleRetain={() =>
                void control({
                  action: "worktree.retain",
                  runId: selected.id,
                  retained: !selected.workspace.retained,
                })
              }
              onRenameBranch={(branch) =>
                void control({
                  action: "worktree.rename",
                  runId: selected.id,
                  branch,
                })
              }
              onExportPatch={() => void exportWorktreePatch(selected)}
              onMergeWorktree={() =>
                void control({ action: "worktree.merge", runId: selected.id })
              }
              onOpenBrowser={() =>
                navigate(
                  `${ROUTES.BROWSER}?runId=${encodeURIComponent(selected.id)}`,
                )
              }
              onPermissionChange={(permissionMode) =>
                void control({
                  action: "permission.set",
                  runId: selected.id,
                  permissionMode,
                })
              }
              onSelectRun={(runId) => setSelectedId(runId)}
              onResubmit={(prompt) => void resubmitRun(selected, prompt)}
              onClose={() => setSelectedId(undefined)}
            />
          )}
          {selectedChat && (
            <ChatSessionDetails
              session={selectedChat}
              loading={openingChatId === selectedChat.sessionId}
              error={chatOpenError}
              onOpen={() => void openChatSession(selectedChat.sessionId)}
              onBack={() => setSelectedChatId(undefined)}
            />
          )}
          {!selected && !selectedChat && (
            <div className="flex h-full min-h-64 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <div className="border-input bg-input mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border">
                  <ChatBubbleLeftRightIcon className="h-5 w-5" />
                </div>
                <h2 className="m-0 text-sm font-semibold">
                  Your development workspace
                </h2>
                <p className="text-description mb-4 mt-2 text-xs leading-relaxed">
                  Select an agent to monitor its work, or choose a saved chat to
                  resume where you left off.
                </p>
                <button
                  type="button"
                  onClick={() => void openCreate(undefined)}
                  className="bg-button text-button-foreground cursor-pointer rounded-md border-none px-3 py-2 text-xs font-medium"
                >
                  Start a new agent
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
