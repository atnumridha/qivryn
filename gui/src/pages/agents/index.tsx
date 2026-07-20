import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
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
} from "@qivryn/agent-runtime/contracts";
import {
  AGENT_ACTIVE_RUN_STATUSES,
  AGENT_LIVE_RUN_STATUSES,
  filterAgentRuns,
  formatAgentRunStatus,
} from "@qivryn/agent-runtime/presentation";
import type {
  BaseSessionMetadata,
  ContextProviderDescription,
  ContextSubmenuItem,
} from "core";
import { formatQivrynDeepLink } from "@qivryn/agent-runtime/deep-links";
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
  CommandLineIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  QueueListIcon,
  SquaresPlusIcon,
  StarIcon,
  WrenchScrewdriverIcon,
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
import {
  IdeMessengerContext,
  type IIdeMessenger,
} from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setMode } from "../../redux/slices/sessionSlice";
import { exitEdit } from "../../redux/thunks/edit";
import { loadSession, saveCurrentSession } from "../../redux/thunks/session";
import { ROUTES } from "../../util/navigation";
import { isQivrynStandalone } from "../../util/isQivrynStandalone";
import ModelSelect from "../../components/modelSelection/ModelSelect";
import { ReasoningEffortSelect } from "../../components/modelSelection/ReasoningEffortSelect";
import { ModeSelect } from "../../components/ModeSelect";
import { VoiceInputButton } from "../../components/mainInput/VoiceInputButton";
import StyledMarkdownPreview from "../../components/StyledMarkdownPreview";
import "./agents.css";
import { AgentAutomationsPanel } from "./AgentAutomationsPanel";
import { SkillSelect } from "../../components/skills/SkillSelect";

const CHAT_OPEN_TIMEOUT_MS = 15_000;
const AGENT_FOLLOW_UP_RESUME_STATUSES = new Set<AgentRun["status"]>([
  "draft",
  "attention",
  "completed",
  "failed",
  "canceled",
]);
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

function appendVoiceTranscript(current: string, transcript: string): string {
  const existing = current.trimEnd();
  return existing ? `${existing} ${transcript}` : transcript;
}

function repositoryDisplayName(repositoryPath: string): string | undefined {
  return repositoryPath
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
}

const LAST_AGENT_REPOSITORY_KEY = "qivryn.agents.lastRepository";
const AGENT_REPOSITORY_CHANGED_EVENT = "qivryn:agent-repository-changed";

function initialAgentRepositoryPath(): string {
  const stored = window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY);
  if (stored?.trim()) {
    return normalizeFilePath(stored);
  }
  return normalizeFilePath(window.workspacePaths?.[0] ?? "");
}

function syncSelectedRepositoryWithIde(
  ideMessenger: IIdeMessenger,
  repositoryPath: string,
): void {
  void ideMessenger.request("agents/setSelectedRepository", {
    path: repositoryPath || undefined,
  });
}

export function normalizeFilePath(value: string): string {
  if (value.startsWith("file:")) {
    try {
      const uri = new URL(value);
      const pathname = decodeURIComponent(uri.pathname).replace(/\\/g, "/");
      if (uri.hostname && uri.hostname !== "localhost") {
        return `//${uri.hostname}${pathname}`;
      }
      return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      // Fall through for malformed legacy values.
    }
  }
  const withoutScheme = value.replace(/^file:\/\//, "");
  try {
    return decodeURIComponent(withoutScheme).replace(/\\/g, "/");
  } catch {
    return withoutScheme.replace(/\\/g, "/");
  }
}

export function fileUriFromPath(value: string): string {
  const normalized = normalizeFilePath(value);
  if (normalized.startsWith("//")) {
    const [host, ...segments] = normalized.slice(2).split("/");
    return `file://${host}/${segments.map(encodeURIComponent).join("/")}`;
  }
  const drivePath = /^[A-Za-z]:\//.test(normalized);
  const segments = normalized
    .split("/")
    .map((segment, index) =>
      drivePath && index === 0 ? segment : encodeURIComponent(segment),
    );
  const encoded = segments.join("/");
  return drivePath ? `file:///${encoded}` : `file://${encoded}`;
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
    const uris = references.map((reference) =>
      fileUriFromPath(
        `${repositoryPath.replace(/[\\/]$/, "")}/${reference.replace(/^[\\/]/, "")}`,
      ),
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
          title="Add context"
          onClick={() => {
            setMessage(undefined);
            setOpen((value) => !value);
          }}
          className="border-input bg-input hover:bg-list-hover relative flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border p-0"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {items.length > 0 && (
            <span className="bg-button text-button-foreground absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px]">
              {items.length}
            </span>
          )}
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
    .filter(Boolean);
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

const EVENT_BATCH_SIZE = 200;
const MAX_PARALLEL_TASKS = 12;

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
      payload.to ??
      payload.result;
    if (typeof value === "string") return value;
  }
  return "";
}

function agentEventSequence(event: AgentEvent): number {
  const sequence = Number(event.sequence);
  return Number.isFinite(sequence) ? sequence : 0;
}

function normalizeAgentEvents(
  value: unknown,
  fallbackRunId?: string,
): AgentEvent[] {
  if (!Array.isArray(value)) return [];

  const usedSequences = new Set<number>();
  return value
    .flatMap((item, index): AgentEvent[] => {
      if (!item || typeof item !== "object") return [];

      const event = item as Partial<AgentEvent>;
      if (typeof event.kind !== "string" || !event.kind.trim()) return [];

      let sequence = Number(event.sequence);
      if (!Number.isFinite(sequence) || sequence <= 0) {
        sequence = index + 1;
      }
      while (usedSequences.has(sequence)) sequence += 1;
      usedSequences.add(sequence);

      const runId =
        typeof event.runId === "string" && event.runId.trim()
          ? event.runId
          : fallbackRunId || "agent-run";

      return [
        {
          id:
            typeof event.id === "string" && event.id.trim()
              ? event.id
              : `${runId}-event-${sequence}`,
          runId,
          sequence,
          kind: event.kind as AgentEvent["kind"],
          createdAt:
            typeof event.createdAt === "string" && event.createdAt.trim()
              ? event.createdAt
              : new Date().toISOString(),
          payload: event.payload ?? {},
        },
      ];
    })
    .sort((a, b) => agentEventSequence(a) - agentEventSequence(b));
}

function isInternalRuntimeEvent(event: AgentEvent): boolean {
  if (event.kind === "run.progress" || event.kind === "run.status") {
    return true;
  }
  if (event.kind !== "runtime.notice") return false;
  const payload = eventPayload(event);
  if (payload.type === "hook.result" && !eventSummary(event)) return true;
  return /approaching context limit|auto-compact|history compacted|context optimized|bounded local summary/i.test(
    eventSummary(event),
  );
}

function pendingAgentApprovals(events: AgentEvent[]): AgentApprovalRequest[] {
  const pending = new Map<string, AgentApprovalRequest>();
  for (const event of [...events].sort(
    (a, b) => agentEventSequence(a) - agentEventSequence(b),
  )) {
    const payload = eventPayload(event);
    if (event.kind === "approval.requested") {
      const id = String(payload.id ?? payload.approvalId ?? event.id);
      pending.set(id, {
        id,
        runId: event.runId,
        createdAt: event.createdAt,
        title:
          typeof payload.title === "string"
            ? payload.title
            : "Approval required",
        toolName:
          typeof (payload.toolName ?? payload.name) === "string"
            ? String(payload.toolName ?? payload.name)
            : undefined,
        detail:
          typeof (payload.detail ?? payload.text) === "string"
            ? String(payload.detail ?? payload.text)
            : undefined,
        command:
          typeof payload.command === "string" ? payload.command : undefined,
        paths: Array.isArray(payload.paths)
          ? payload.paths.filter(
              (path): path is string => typeof path === "string",
            )
          : undefined,
        status: "pending",
      });
    }
    if (event.kind === "approval.resolved") {
      pending.delete(String(payload.approvalId ?? payload.id ?? ""));
    }
  }
  return [...pending.values()];
}

interface AgentSubagentActivity {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
}

function agentSubagentActivity(events: AgentEvent[]): AgentSubagentActivity[] {
  const subagents = new Map<string, AgentSubagentActivity>();
  for (const event of [...events].sort(
    (a, b) => agentEventSequence(a) - agentEventSequence(b),
  )) {
    if (
      event.kind !== "subagent.created" &&
      event.kind !== "subagent.updated"
    ) {
      continue;
    }
    const payload = eventPayload(event);
    const name =
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : "Subagent";
    const id =
      typeof payload.id === "string" && payload.id.trim()
        ? payload.id.trim()
        : name;
    const status =
      payload.status === "completed" || payload.status === "failed"
        ? payload.status
        : "running";
    subagents.set(id, {
      id,
      name,
      status,
      detail: eventSummary(event) || undefined,
    });
  }
  return [...subagents.values()];
}

function eventPayload(event: AgentEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function toolKey(event: AgentEvent): string {
  const payload = eventPayload(event);
  if (typeof payload.toolCallId === "string" && payload.toolCallId.trim()) {
    return `id:${payload.toolCallId.trim()}`;
  }
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

function ToolIdentityIcon({ event }: { event: AgentEvent }) {
  const name = toolDisplayName(event).toLowerCase();
  const Icon = /terminal|shell|command|process/.test(name)
    ? CommandLineIcon
    : /read|write|edit|file|patch/.test(name)
      ? DocumentTextIcon
      : /list|directory|folder/.test(name)
        ? FolderIcon
        : /search|find|grep/.test(name)
          ? MagnifyingGlassIcon
          : /browser|web|url/.test(name)
            ? GlobeAltIcon
            : /computer|click|screenshot/.test(name)
              ? CursorArrowRaysIcon
              : WrenchScrewdriverIcon;
  return <Icon className="h-3.5 w-3.5" />;
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
          <ToolIdentityIcon event={item.started} />
          <span className="cursor-tool-status-indicator" aria-hidden="true" />
          <span className="sr-only">
            {failed ? "Failed" : running ? "Running" : "Completed"}
          </span>
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

function isAgentProcessActivity(item: ToolConversationItem): boolean {
  const payload = eventPayload(item.started);
  return (
    payload.scope === "process" || toolKey(item.started) === "__agent_process__"
  );
}

function isPrimaryConversationEvent(event: AgentEvent): boolean {
  return (
    event.kind === "message.user" ||
    event.kind === "message.assistant" ||
    event.kind === "message.reasoning"
  );
}

function renderConversationItem(
  item: ConversationItem,
  onEditAndResend?: (prompt: string) => void,
) {
  return item.type === "tool" ? (
    <ToolActivityCard key={item.id} item={item} />
  ) : (
    <ConversationEventCard
      key={item.event.id}
      event={item.event}
      onEditAndResend={onEditAndResend}
    />
  );
}

function ActivityDrawer({
  items,
  onEditAndResend,
}: {
  items: ConversationItem[];
  onEditAndResend?: (prompt: string) => void;
}) {
  if (items.length === 0) return null;
  const toolItems = items.filter((item) => item.type === "tool");
  const runtimeItems = items.filter((item) => item.type === "event");
  const toolCount = toolItems.length;
  const eventCount = runtimeItems.length;
  const summary =
    toolCount > 0
      ? `${toolCount} tool ${toolCount === 1 ? "call" : "calls"}`
      : `${eventCount} runtime ${eventCount === 1 ? "event" : "events"}`;
  return (
    <div
      className="cursor-agent-activity-drawer"
      data-testid="agent-activity-drawer"
      role="group"
      aria-label={summary}
    >
      <div className="cursor-agent-activity-body">
        {toolItems.map((item) => renderConversationItem(item, onEditAndResend))}
        {runtimeItems.length > 0 && (
          <details className="cursor-agent-runtime-drawer">
            <summary className="cursor-agent-activity-summary">
              <ChevronRightIcon className="cursor-agent-activity-chevron h-3 w-3" />
              <span>Activity</span>
              <span>
                {eventCount} {eventCount === 1 ? "event" : "events"}
              </span>
            </summary>
            <div className="cursor-agent-runtime-events">
              {runtimeItems.map((item) =>
                renderConversationItem(item, onEditAndResend),
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function ConversationEventCard({
  event,
  onEditAndResend,
}: {
  event: AgentEvent;
  onEditAndResend?: (prompt: string) => void;
}) {
  const summary = eventSummary(event) || `Event ${agentEventSequence(event)}`;
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
  const [visibleEventLimit, setVisibleEventLimit] = useState(EVENT_BATCH_SIZE);
  const displayEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          !isInternalRuntimeEvent(event) &&
          !(
            event.kind.startsWith("tool.") &&
            eventPayload(event).scope === "process"
          ),
      ),
    [events],
  );
  const allConversationItems = useMemo(
    () => groupConversationEvents(displayEvents),
    [displayEvents],
  );
  const hiddenItemCount = Math.max(
    0,
    allConversationItems.length - visibleEventLimit,
  );
  const conversationItems = useMemo(
    () =>
      hiddenItemCount > 0
        ? allConversationItems.slice(-visibleEventLimit)
        : allConversationItems,
    [allConversationItems, hiddenItemCount, visibleEventLimit],
  );
  const timelineGroups = useMemo(() => {
    const groups: Array<
      | { type: "primary"; item: ConversationItem }
      | { type: "activity"; id: string; items: ConversationItem[] }
    > = [];
    let activity: ConversationItem[] = [];
    const flushActivity = () => {
      if (activity.length === 0) return;
      const first = activity[0];
      groups.push({
        type: "activity",
        id: first.type === "tool" ? first.id : `activity-${first.event.id}`,
        items: activity,
      });
      activity = [];
    };
    for (const item of conversationItems) {
      if (item.type === "event" && isPrimaryConversationEvent(item.event)) {
        flushActivity();
        groups.push({ type: "primary", item });
      } else if (item.type !== "tool" || !isAgentProcessActivity(item)) {
        activity.push(item);
      }
    }
    flushActivity();
    return groups;
  }, [conversationItems]);
  useEffect(() => {
    setVisibleEventLimit(EVENT_BATCH_SIZE);
  }, [events[0]?.runId]);
  if (displayEvents.length === 0) return null;
  return (
    <div
      aria-label="Agent conversation"
      className="cursor-conversation-timeline mt-3 space-y-1.5"
    >
      {hiddenItemCount > 0 && (
        <button
          type="button"
          onClick={() =>
            setVisibleEventLimit((current) => current + EVENT_BATCH_SIZE)
          }
          className="border-input text-description hover:bg-list-hover mx-auto flex cursor-pointer items-center rounded-full border bg-transparent px-3 py-1 text-[11px]"
        >
          Show {Math.min(EVENT_BATCH_SIZE, hiddenItemCount)} earlier events
        </button>
      )}
      {timelineGroups.map((group) =>
        group.type === "primary" ? (
          renderConversationItem(group.item, onEditAndResend)
        ) : (
          <ActivityDrawer
            key={group.id}
            items={group.items}
            onEditAndResend={onEditAndResend}
          />
        ),
      )}
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
  const ageMilliseconds = Math.max(
    0,
    Date.now() - new Date(run.updatedAt).getTime(),
  );
  const relativeTime =
    ageMilliseconds < 60_000
      ? "now"
      : ageMilliseconds < 3_600_000
        ? `${Math.floor(ageMilliseconds / 60_000)}m`
        : ageMilliseconds < 86_400_000
          ? `${Math.floor(ageMilliseconds / 3_600_000)}h`
          : `${Math.floor(ageMilliseconds / 86_400_000)}d`;
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
        aria-label={formatAgentRunStatus(run.status)}
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
      {run.pinned && (
        <StarIcon
          aria-label="Pinned"
          className="text-warning h-3 w-3 flex-shrink-0"
        />
      )}
      <time
        className="text-description text-2xs flex-shrink-0"
        dateTime={run.updatedAt}
        title={new Date(run.updatedAt).toLocaleString()}
      >
        {AGENT_LIVE_RUN_STATUSES.has(run.status) ? "Live" : relativeTime}
      </time>
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
  onResolveApproval,
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
  onQueue: (
    prompt: string,
    behavior: AgentQueueItem["behavior"],
  ) => Promise<boolean>;
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
  onResolveApproval: (
    approvalId: string,
    decision: AgentApprovalDecision,
  ) => void;
  onResubmit: (prompt: string) => void;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
}) {
  const [followUp, setFollowUp] = useState("");
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string>();
  const isActiveFollowUp = ["running", "waiting"].includes(run.status);
  const queueBehavior: AgentQueueItem["behavior"] = isActiveFollowUp
    ? "steer"
    : "run-next";
  const [followUpBehavior, setFollowUpBehavior] =
    useState<AgentQueueItem["behavior"]>(queueBehavior);
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
  const footerStackRef = useRef<HTMLDivElement>(null);
  const followLiveOutputRef = useRef(true);

  useEffect(() => {
    setFollowUpBehavior(queueBehavior);
  }, [queueBehavior, run.id]);

  const submitFollowUp = async (
    behavior: AgentQueueItem["behavior"] = followUpBehavior,
  ) => {
    if (!followUp.trim() || sendingFollowUp) return;
    const prompt = withSkill(
      withContext(followUp.trim(), contextItems),
      selectedSkill,
    );
    setFollowUpError(undefined);
    if (resubmitSource !== undefined) {
      onResubmit(prompt);
      setResubmitSource(undefined);
      setFollowUp("");
      setContextItems([]);
      return;
    }

    setSendingFollowUp(true);
    try {
      const sent = await onQueue(prompt, behavior);
      if (!sent) {
        setFollowUpError("Follow-up was not sent. Try again.");
        return;
      }
      setFollowUp("");
      setContextItems([]);
    } catch {
      setFollowUpError("Follow-up was not sent. Try again.");
    } finally {
      setSendingFollowUp(false);
    }
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
            !isInternalRuntimeEvent(event) &&
            (event.kind.startsWith("message.") ||
              event.kind.startsWith("tool.") ||
              event.kind === "runtime.notice" ||
              event.kind === "review.finding"),
        ),
        false,
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
  const pendingApprovals = useMemo(
    () => pendingAgentApprovals(events),
    [events],
  );
  const streamedSubagents = useMemo(
    () => agentSubagentActivity(events),
    [events],
  );
  const activeSubagentCount =
    childRuns.filter((child) => AGENT_LIVE_RUN_STATUSES.has(child.status))
      .length +
    streamedSubagents.filter((subagent) => subagent.status === "running")
      .length;
  const totalSubagentCount = childRuns.length + streamedSubagents.length;
  useEffect(() => {
    const element = conversationScrollRef.current;
    if (!element || !followLiveOutputRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationEvents]);
  useEffect(() => {
    const footer = footerStackRef.current;
    if (!footer || typeof ResizeObserver === "undefined") return;
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      const element = conversationScrollRef.current;
      if (!element || !followLiveOutputRef.current) return;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    });
    observer.observe(footer);
    return () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [run.id]);
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
              className="cursor-agent-chat-title hover:text-link block max-w-full cursor-text truncate border-none bg-transparent p-0 text-left text-sm font-medium"
              onClick={() => {
                setTitle(run.title);
                setEditingTitle(true);
              }}
            >
              {run.title}
            </button>
          )}
          <div className="sr-only mt-1.5 min-w-0 flex-wrap items-center gap-1.5">
            <span className="cursor-agent-status-pill" data-status={run.status}>
              <span
                className={`cursor-agent-status-dot ${statusColor(run.status)}`}
              />
              {formatAgentRunStatus(run.status)}
            </span>
            <span className="cursor-agent-meta-pill">{run.permissionMode}</span>
            <span className="text-description text-2xs min-w-0 truncate">
              {run.model ?? "Default model"}
            </span>
            {AGENT_LIVE_RUN_STATUSES.has(run.status) && (
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
        <div className="cursor-agent-header-actions flex flex-shrink-0 items-center gap-0.5">
          {!["completed", "archived"].includes(run.status) && (
            <button
              type="button"
              className="hover:bg-list-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent"
              aria-label={
                ["running", "queued", "waiting"].includes(run.status)
                  ? "Cancel agent"
                  : "Resume agent"
              }
              title={
                ["running", "queued", "waiting"].includes(run.status)
                  ? "Cancel agent"
                  : "Resume agent"
              }
              onClick={onRunAction}
            >
              {["running", "queued", "waiting"].includes(run.status) ? (
                <XMarkIcon className="h-3.5 w-3.5" />
              ) : (
                <ArrowPathIcon className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            className="hover:bg-list-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent"
            aria-label={run.pinned ? "Unpin agent" : "Pin agent"}
            title={run.pinned ? "Unpin agent" : "Pin agent"}
            onClick={onPin}
          >
            <StarIcon
              className={`h-3.5 w-3.5 ${run.pinned ? "fill-warning text-warning" : ""}`}
            />
          </button>
          <button
            type="button"
            className="hover:bg-list-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent"
            aria-label="Duplicate agent"
            title="Duplicate agent"
            onClick={onDuplicate}
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="hover:bg-list-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent"
            aria-label={
              run.status === "archived" ? "Unarchive agent" : "Archive agent"
            }
            title={
              run.status === "archived" ? "Unarchive agent" : "Archive agent"
            }
            onClick={onArchive}
          >
            <ArchiveBoxIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="cursor-agent-run-meta text-description text-2xs sr-only mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
      {totalSubagentCount > 0 && (
        <section aria-label="Subagents" className="cursor-agent-subagents mt-2">
          <div className="cursor-agent-subagents-header flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
              <SquaresPlusIcon className="h-3.5 w-3.5 flex-shrink-0" />
              Subagents
            </span>
            <span className="text-description text-2xs">
              {activeSubagentCount} active · {totalSubagentCount} total
            </span>
          </div>
          <div className="cursor-agent-subagents-list">
            {childRuns.map((child) => (
              <button
                type="button"
                key={child.id}
                aria-label={`Open subagent ${child.title}`}
                onClick={() => onSelectRun(child.id)}
                className="cursor-agent-subagent-row hover:bg-list-hover flex w-full min-w-0 cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1.5 text-left"
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
            {streamedSubagents.map((subagent) => (
              <div
                key={subagent.id}
                className="cursor-agent-subagent-row flex min-w-0 items-center gap-2 px-2 py-1.5"
              >
                {subagent.status === "running" ? (
                  <span className="cursor-agent-spinner !h-3 !w-3 flex-shrink-0" />
                ) : subagent.status === "completed" ? (
                  <CheckCircleIcon className="text-success h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <ExclamationTriangleIcon className="text-error h-3.5 w-3.5 flex-shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {subagent.name}
                  </span>
                  <span className="text-description text-2xs block truncate">
                    {subagent.detail ?? formatAgentRunStatus(subagent.status)}
                  </span>
                </span>
                <span className="text-description text-2xs flex-shrink-0">
                  {subagent.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <details className="cursor-agent-actions-menu relative mt-2 w-fit text-xs">
        <summary
          aria-label="Agent actions"
          className="text-description hover:bg-list-hover flex h-6 w-7 cursor-pointer list-none items-center justify-center rounded-md"
        >
          <EllipsisHorizontalIcon aria-hidden="true" className="h-4 w-4" />
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
              className="text-description hover:text-foreground absolute bottom-1 right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 opacity-70 hover:bg-white/5 hover:opacity-100"
            >
              <PencilSquareIcon className="h-3.5 w-3.5" />
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
          {AGENT_LIVE_RUN_STATUSES.has(run.status) && (
            <div
              role="status"
              className="cursor-agent-live-status text-description mt-3 flex items-center gap-2 px-1 text-xs"
            >
              <span className="cursor-agent-spinner" />
              <span>
                {run.status === "waiting"
                  ? "Waiting for your input"
                  : run.status === "queued"
                    ? "Preparing workspace…"
                    : "Working"}
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

      <div
        ref={footerStackRef}
        className="cursor-agent-footer-stack mx-auto w-full max-w-[840px] flex-shrink-0"
      >
        {pendingApprovals.length > 0 && (
          <section
            aria-label="Pending approvals"
            className="cursor-agent-approval-stack mx-auto mt-3 w-full max-w-[840px] space-y-2"
          >
            {pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="cursor-agent-approval border-input bg-editor rounded-lg border px-3 py-3"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <ExclamationTriangleIcon className="text-warning mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{approval.title}</div>
                    {(approval.detail || approval.toolName) && (
                      <div className="text-description mt-1 break-words text-[11px] leading-4">
                        {approval.detail ?? approval.toolName}
                      </div>
                    )}
                    {approval.command && (
                      <code className="cursor-agent-approval-command mt-2 block overflow-x-auto whitespace-pre rounded-md px-2 py-1.5 text-[11px]">
                        {approval.command}
                      </code>
                    )}
                    {approval.paths && approval.paths.length > 0 && (
                      <div className="cursor-agent-approval-paths mt-2 space-y-1">
                        {approval.paths.map((filepath) => (
                          <code
                            key={filepath}
                            className="border-input bg-input block truncate rounded border px-2 py-1 text-[11px]"
                            title={filepath}
                          >
                            {filepath}
                          </code>
                        ))}
                      </div>
                    )}
                    {approval.preview && approval.preview.length > 0 && (
                      <div className="cursor-agent-approval-preview text-description mt-2 space-y-1 text-[11px] leading-4">
                        {approval.preview.map((item, index) => (
                          <div key={`${item.type}-${index}`}>
                            {item.content}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onResolveApproval(approval.id, "approve")
                        }
                        className="qivryn-neutral-primary cursor-pointer rounded-md border-none px-2.5 py-1.5 text-[11px] font-medium"
                      >
                        Allow once
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onResolveApproval(approval.id, "approveAlways")
                        }
                        className="border-input bg-input hover:bg-list-hover cursor-pointer rounded-md border px-2.5 py-1.5 text-[11px]"
                      >
                        Allow similar
                      </button>
                      <button
                        type="button"
                        onClick={() => onResolveApproval(approval.id, "reject")}
                        className="text-description hover:text-error ml-auto cursor-pointer border-none bg-transparent px-2 py-1.5 text-[11px]"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {queue.length > 0 && (
          <div
            className="cursor-agent-queue-stack mx-auto mt-2 w-full max-w-[840px] space-y-1"
            aria-label="Queued follow-ups"
          >
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

        <form
          className="cursor-agent-composer z-10 mx-auto mt-3 min-w-0 flex-shrink-0"
          onSubmit={(event) => {
            event.preventDefault();
            void submitFollowUp();
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
            aria-label={
              isActiveFollowUp ? "Steer active agent" : "Queue follow-up"
            }
            value={followUp}
            onChange={(event) => {
              setFollowUp(event.target.value);
              if (followUpError) setFollowUpError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (
                  isActiveFollowUp &&
                  (event.metaKey || event.ctrlKey) &&
                  resubmitSource === undefined
                ) {
                  void submitFollowUp("run-next");
                  return;
                }
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              resubmitSource === undefined
                ? isActiveFollowUp
                  ? "Steer this agent"
                  : "Ask for follow-up changes"
                : "Edit message and rerun"
            }
            rows={2}
            aria-invalid={followUpError ? true : undefined}
            aria-describedby={
              followUpError ? "agent-follow-up-error" : undefined
            }
            className="cursor-agent-composer-input bg-input box-border w-full resize-none border-none px-1 py-1 text-xs outline-none"
          />
          {followUpError && (
            <div
              id="agent-follow-up-error"
              role="alert"
              className="text-error mt-1 px-1 text-[11px]"
            >
              {followUpError}
            </div>
          )}
          <div className="cursor-agent-composer-toolbar mt-2 flex min-w-0 items-center justify-between gap-2">
            <div className="qivryn-agent-composer-tools flex min-w-0 items-center gap-1.5">
              <ModeSelect
                skillName={selectedSkill}
                onSkillChange={setSelectedSkill}
                agentAccessMode={run.permissionMode}
                onAgentAccessModeChange={onPermissionChange}
                includeAgentControls
              />
              <AgentContextPicker
                repositoryPath={run.workspace.repositoryPath}
                items={contextItems}
                onChange={setContextItems}
              />
              {isActiveFollowUp && resubmitSource === undefined && (
                <div
                  className="qivryn-follow-up-behavior"
                  role="group"
                  aria-label="Follow-up delivery"
                >
                  <button
                    type="button"
                    aria-label="Steer now"
                    aria-pressed={followUpBehavior === "steer"}
                    title="Add this guidance to the active turn"
                    onClick={() => setFollowUpBehavior("steer")}
                  >
                    <CursorArrowRaysIcon aria-hidden="true" />
                    <span>Steer</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Use queue next"
                    aria-pressed={followUpBehavior === "run-next"}
                    title="Run this after the active turn finishes"
                    onClick={() => setFollowUpBehavior("run-next")}
                  >
                    <QueueListIcon aria-hidden="true" />
                    <span>Next</span>
                  </button>
                </div>
              )}
            </div>
            <div className="qivryn-agent-composer-submit-cluster">
              <VoiceInputButton
                disabled={sendingFollowUp}
                onInsert={(text) =>
                  setFollowUp((current) => appendVoiceTranscript(current, text))
                }
              />
              <ModeSelect modelOnly />
              <button
                type="submit"
                aria-label={
                  isActiveFollowUp
                    ? followUpBehavior === "steer"
                      ? "Steer"
                      : "Queue next"
                    : "Send"
                }
                title={
                  isActiveFollowUp
                    ? followUpBehavior === "steer"
                      ? "Steer this turn"
                      : "Queue the next turn"
                    : "Send"
                }
                disabled={!followUp.trim() || sendingFollowUp}
                aria-busy={sendingFollowUp || undefined}
                className="qivryn-codex-send-button"
              >
                {sendingFollowUp ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUpIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
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
  const [showAutomations, setShowAutomations] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [showWideNavigation, setShowWideNavigation] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showCreateComposer, setShowCreateComposer] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newRepository, setNewRepository] = useState(
    initialAgentRepositoryPath,
  );
  const [newRuntime, setNewRuntime] = useState<"local" | "docker" | "ssh">(
    "local",
  );
  const [newContainerImage, setNewContainerImage] = useState(
    "qivryn-agent:latest",
  );
  const [newSshHost, setNewSshHost] = useState("");
  const [newPermissionMode, setNewPermissionMode] =
    useState<AgentRun["permissionMode"]>("autonomous");
  const [newParentRunId, setNewParentRunId] = useState<string>();
  const [newSkill, setNewSkill] = useState<string>();
  const [newContextItems, setNewContextItems] = useState<AgentContextItem[]>(
    [],
  );
  const [activeWorkspacePath, setActiveWorkspacePath] = useState(() =>
    normalizeFilePath(window.workspacePaths?.[0] ?? ""),
  );
  const [starting, setStarting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const newTaskRef = useRef<HTMLTextAreaElement>(null);
  const lastEventSequenceRef = useRef(0);
  const eventPollInFlightRef = useRef(false);
  const openedCreateFromRouteRef = useRef(false);
  const openedScheduleFromRouteRef = useRef(false);
  const openedPanelFromRouteRef = useRef(false);

  useEffect(() => {
    const onRepositoryChanged = (event: Event) => {
      const repositoryPath =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY) || "";
      setNewRepository(repositoryPath ? normalizeFilePath(repositoryPath) : "");
    };
    window.addEventListener(
      AGENT_REPOSITORY_CHANGED_EVENT,
      onRepositoryChanged,
    );
    return () => {
      window.removeEventListener(
        AGENT_REPOSITORY_CHANGED_EVENT,
        onRepositoryChanged,
      );
    };
  }, []);

  useEffect(() => {
    const injectedWorkspace = normalizeFilePath(
      window.workspacePaths?.[0] ?? "",
    );
    if (injectedWorkspace) {
      setActiveWorkspacePath(injectedWorkspace);
      return;
    }
    let disposed = false;
    void ideMessenger
      .request("getWorkspaceDirs", undefined)
      .then((response) => {
        if (disposed || response.status !== "success") {
          return;
        }
        const workspacePath = normalizeFilePath(response.content[0] ?? "");
        if (workspacePath) {
          setActiveWorkspacePath(workspacePath);
        }
      });
    return () => {
      disposed = true;
    };
  }, [ideMessenger]);

  const appendEvents = useCallback(
    (incoming: unknown) => {
      const normalizedIncoming = normalizeAgentEvents(incoming, selectedId);
      if (normalizedIncoming.length === 0) return;
      lastEventSequenceRef.current = Math.max(
        lastEventSequenceRef.current,
        normalizedIncoming.at(-1)?.sequence ?? 0,
      );
      setEvents((current) => {
        const known = new Set(
          current.map((event) => agentEventSequence(event)),
        );
        return [
          ...current,
          ...normalizedIncoming.filter(
            (event) => !known.has(agentEventSequence(event)),
          ),
        ].sort((a, b) => agentEventSequence(a) - agentEventSequence(b));
      });
    },
    [selectedId],
  );

  const loadRuns = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError(undefined);
      const response = await ideMessenger.request("agents/list", {
        includeArchived: true,
        limit: 500,
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
          const normalizedEvents = normalizeAgentEvents(
            eventResponse.content,
            selectedId,
          );
          setEvents(normalizedEvents);
          lastEventSequenceRef.current = normalizedEvents.at(-1)?.sequence ?? 0;
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

  const latestRunStatus = useCallback(
    async (
      runId: string,
      fallback: AgentRun["status"],
    ): Promise<AgentRun["status"]> => {
      const response = await ideMessenger.request("agents/list", {
        includeArchived: true,
        limit: 500,
      });
      if (response.status !== "success") return fallback;
      return (
        response.content.find((candidate) => candidate.id === runId)?.status ??
        fallback
      );
    },
    [ideMessenger],
  );

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
          const normalizedEvents =
            response.status === "success"
              ? normalizeAgentEvents(response.content, selectedId)
              : [];
          if (normalizedEvents.length === 0) {
            return;
          }
          appendEvents(normalizedEvents);
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
      setShowCreateComposer(false);
      setSelectedChatId(undefined);
      setChatOpenError(undefined);
      setSelectedId(run.id);
      setShowWideNavigation(false);
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
      if (!parentRunId) {
        setShowCreateComposer(false);
        setNewParentRunId(undefined);
        setNewPrompt("");
        setNewContextItems([]);
        dispatch(setMode("agent"));
        navigate(ROUTES.HOME, { replace: true });
        return;
      }
      setSelectedId(undefined);
      setSelectedChatId(undefined);
      setChatOpenError(undefined);
      setShowWideNavigation(false);
      setShowCreateComposer(true);
      setNewParentRunId(parentRunId);
      setNewPrompt("");
      setNewContextItems([]);
      dispatch(setMode("agent"));
      window.setTimeout(() => newTaskRef.current?.focus(), 0);
      if (newRepository) return;
      const fallback =
        runs.find((run) => run.id === parentRunId)?.workspace.repositoryPath ??
        runs.find((run) => run.id === selectedId)?.workspace.repositoryPath ??
        runs.find((run) => run.workspace.repositoryPath)?.workspace
          .repositoryPath ??
        chatSessions.find((session) => session.workspaceDirectory)
          ?.workspaceDirectory ??
        (window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY)?.trim() ||
          undefined) ??
        "";
      if (fallback) {
        setNewRepository(normalizeFilePath(fallback));
        return;
      }
      const response = await ideMessenger.request(
        "getWorkspaceDirs",
        undefined,
      );
      if (response.status === "success" && response.content[0]) {
        setNewRepository(normalizeFilePath(response.content[0]));
        return;
      }
      if (activeWorkspacePath) setNewRepository(activeWorkspacePath);
    },
    [
      chatSessions,
      dispatch,
      ideMessenger,
      navigate,
      newRepository,
      runs,
      selectedId,
      activeWorkspacePath,
    ],
  );

  useEffect(() => {
    const createParam = searchParams.get("new") ?? searchParams.get("create");
    const shouldOpenCreate =
      createParam === "1" || createParam === "true" || createParam === "agent";
    if (!shouldOpenCreate) {
      openedCreateFromRouteRef.current = false;
      return;
    }
    if (openedCreateFromRouteRef.current) return;
    openedCreateFromRouteRef.current = true;
    setShowCreateComposer(false);
    setNewParentRunId(undefined);
    setNewPrompt("");
    setNewContextItems([]);
    dispatch(setMode("agent"));
    navigate(ROUTES.HOME, { replace: true });
  }, [dispatch, navigate, searchParams]);

  useEffect(() => {
    const scheduleParam =
      searchParams.get("scheduled") ?? searchParams.get("automations");
    const shouldOpenSchedule =
      scheduleParam === "1" || scheduleParam === "true";
    if (!shouldOpenSchedule) {
      openedScheduleFromRouteRef.current = false;
      return;
    }
    if (openedScheduleFromRouteRef.current) return;
    openedScheduleFromRouteRef.current = true;
    setShowAutomations(true);
    navigate(ROUTES.AGENTS, { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    const panelParam =
      searchParams.get("panel") ?? searchParams.get("sessions");
    const shouldOpenPanel = panelParam === "1" || panelParam === "true";
    if (!shouldOpenPanel) {
      openedPanelFromRouteRef.current = false;
      return;
    }
    if (openedPanelFromRouteRef.current) return;
    openedPanelFromRouteRef.current = true;
    setShowWideNavigation(true);
  }, [searchParams]);

  useEffect(() => {
    const createParam = searchParams.get("new") ?? searchParams.get("create");
    const scheduleParam =
      searchParams.get("scheduled") ?? searchParams.get("automations");
    const panelParam =
      searchParams.get("panel") ?? searchParams.get("sessions");
    const hasCreateRequest =
      createParam === "1" || createParam === "true" || createParam === "agent";
    const hasScheduleRequest =
      scheduleParam === "1" || scheduleParam === "true";
    const hasPanelRequest = panelParam === "1" || panelParam === "true";
    const hasDeepLink =
      Boolean(searchParams.get("runId")) ||
      Boolean(searchParams.get("eventSequence")) ||
      Boolean(searchParams.get("checkpointId"));
    const hasSubagentComposer = showCreateComposer && Boolean(newParentRunId);
    if (
      loading ||
      selectedId ||
      selectedChatId ||
      newParentRunId ||
      hasSubagentComposer ||
      showAutomations ||
      hasCreateRequest ||
      hasScheduleRequest ||
      hasPanelRequest ||
      hasDeepLink
    ) {
      return;
    }
    dispatch(setMode("agent"));
    navigate(ROUTES.HOME, { replace: true });
  }, [
    dispatch,
    loading,
    navigate,
    newParentRunId,
    searchParams,
    selectedChatId,
    selectedId,
    showCreateComposer,
    showAutomations,
  ]);

  const chooseRepository = useCallback(async () => {
    const response = await ideMessenger.request(
      "agents/selectRepository",
      undefined,
    );
    if (response.status === "success" && response.content) {
      const repositoryPath = normalizeFilePath(response.content);
      setNewRepository(repositoryPath);
      window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, repositoryPath);
      syncSelectedRepositoryWithIde(ideMessenger, repositoryPath);
      window.dispatchEvent(
        new CustomEvent(AGENT_REPOSITORY_CHANGED_EVENT, {
          detail: repositoryPath,
        }),
      );
    }
  }, [ideMessenger]);

  const clearRepository = useCallback(() => {
    setNewRepository("");
    window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, "");
    syncSelectedRepositoryWithIde(ideMessenger, activeWorkspacePath);
    window.dispatchEvent(
      new CustomEvent(AGENT_REPOSITORY_CHANGED_EVENT, {
        detail: "",
      }),
    );
  }, [activeWorkspacePath, ideMessenger]);

  const createRun = useCallback(async () => {
    const tasks = newParentRunId
      ? [newPrompt.trim()].filter(Boolean)
      : parseMultitaskItems(newPrompt);
    if (!tasks.length || tasks.length > MAX_PARALLEL_TASKS) {
      return;
    }
    setStarting(true);
    setError(undefined);
    let repositoryPath = normalizeFilePath(newRepository.trim());
    if (!repositoryPath) {
      const workspaceResponse = await ideMessenger.request(
        "getWorkspaceDirs",
        undefined,
      );
      repositoryPath =
        workspaceResponse.status === "success"
          ? normalizeFilePath(workspaceResponse.content[0] ?? "")
          : "";
    }
    if (!repositoryPath) {
      repositoryPath = normalizeFilePath(window.workspacePaths?.[0] ?? "");
    }
    if (!repositoryPath) {
      repositoryPath = activeWorkspacePath;
    }
    if (!repositoryPath) {
      setStarting(false);
      setError("Choose a workspace before starting an agent.");
      return;
    }
    setNewRepository(repositoryPath);
    syncSelectedRepositoryWithIde(ideMessenger, repositoryPath);
    const responses = await Promise.all(
      tasks.map((task) =>
        ideMessenger.request("agents/control", {
          action: "run.create",
          request: {
            prompt: withSkill(withContext(task, newContextItems), newSkill),
            model: selectedAgentModel?.title,
            permissionMode: newPermissionMode,
            parentRunId: tasks.length === 1 ? newParentRunId : undefined,
            runtimeId: newRuntime,
            metadata: {
              reasoningEffort: selectedReasoningEffort,
              ...(newRuntime === "docker"
                ? {
                    container: {
                      image: newContainerImage.trim() || "qivryn-agent:latest",
                      network: "bridge",
                      privileged: false,
                    },
                  }
                : newRuntime === "ssh"
                  ? {
                      ssh: {
                        host: newSshHost.trim(),
                        remotePath: repositoryPath,
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
              repositoryPath,
            },
          },
        }),
      ),
    );
    setStarting(false);
    const failures = responses.filter(
      (response) => response.status === "error",
    );
    const firstSuccess = responses.find(
      (response) => response.status === "success",
    );
    if (!firstSuccess || firstSuccess.status !== "success") {
      setError(
        failures.length === 1
          ? failures[0].error
          : `${failures.length} tasks could not start`,
      );
      return;
    }
    if (failures.length > 0) {
      setError(
        `${failures.length} of ${responses.length} tasks could not start`,
      );
    }
    const run = firstSuccess.content as AgentRun;
    window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, repositoryPath);
    syncSelectedRepositoryWithIde(ideMessenger, repositoryPath);
    window.dispatchEvent(
      new CustomEvent(AGENT_REPOSITORY_CHANGED_EVENT, {
        detail: repositoryPath,
      }),
    );
    setNewPrompt("");
    setNewContextItems([]);
    setNewParentRunId(undefined);
    setShowCreateComposer(false);
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
    activeWorkspacePath,
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
      anchor.download = `qivryn-agent-${run.id}.json`;
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
      anchor.download = `qivryn-agent-${run.id}.patch`;
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

  const visibleRuns = useMemo(
    () =>
      runs.filter((run) =>
        showArchived ? run.status === "archived" : run.status !== "archived",
      ),
    [runs, showArchived],
  );
  const filtered = useMemo(
    () => filterAgentRuns(visibleRuns, query),
    [query, visibleRuns],
  );
  const filteredChatSessions = useMemo(() => {
    if (showArchived) return [];
    const normalized = query.trim().toLowerCase();
    return normalized
      ? chatSessions.filter((session) =>
          [session.title, session.workspaceDirectory]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalized)),
        )
      : chatSessions;
  }, [chatSessions, query, showArchived]);
  const repositoryChoices = useMemo(
    () =>
      Array.from(
        new Set(
          [
            activeWorkspacePath,
            ...runs.map((run) => run.workspace.repositoryPath),
            ...chatSessions.map((session) => session.workspaceDirectory),
          ].filter((repository): repository is string => Boolean(repository)),
        ),
      ).slice(0, 8),
    [activeWorkspacePath, chatSessions, runs],
  );
  const effectiveNewRepository = useMemo(
    () =>
      normalizeFilePath(newRepository.trim()) ||
      activeWorkspacePath ||
      normalizeFilePath(window.workspacePaths?.[0] ?? ""),
    [activeWorkspacePath, newRepository],
  );
  const newTaskCount = useMemo(
    () =>
      newParentRunId
        ? newPrompt.trim()
          ? 1
          : 0
        : parseMultitaskItems(newPrompt).length,
    [newParentRunId, newPrompt],
  );
  const active = filtered.filter((run) =>
    AGENT_ACTIVE_RUN_STATUSES.has(run.status),
  );
  const recent = filtered.filter(
    (run) => !AGENT_ACTIVE_RUN_STATUSES.has(run.status),
  );
  const selected = filtered.find((run) => run.id === selectedId);
  const selectedChat = chatSessions.find(
    (session) => session.sessionId === selectedChatId,
  );
  const openChatSession = useCallback(
    async (sessionId: string) => {
      setOpeningChatId(sessionId);
      setChatOpenError(undefined);
      try {
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
    [dispatch, navigate],
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
      setShowCapabilities(false);
      setSelectedId(newParentRunId);
      setSelectedChatId(undefined);
      setNewParentRunId(undefined);
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
      className="qivryn-agents-cursor relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
    >
      <header className="cursor-agents-toolbar relative flex flex-shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          aria-label="Back to chat"
          onClick={() => {
            if (isQivrynStandalone()) {
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
        <div className="cursor-agents-toolbar-title min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          <span className="cursor-agents-brand-mark" aria-hidden="true" />
          <span className="hidden min-[520px]:inline">Agent workspace</span>
          <span className="min-[520px]:hidden">Qivryn</span>
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
          title="New agent"
          onClick={() => void openCreate(undefined)}
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Scheduled agent tasks"
          title="Scheduled local agent tasks"
          onClick={() => setShowAutomations(true)}
          className="hover:bg-list-hover focus-visible:ring-border-focus hidden h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1 min-[520px]:flex min-[960px]:w-auto min-[960px]:gap-1.5 min-[960px]:px-2"
        >
          <ClockIcon className="h-3.5 w-3.5" />
          <span className="hidden text-xs min-[960px]:inline">Scheduled</span>
        </button>
        <button
          type="button"
          aria-label="Agent capabilities"
          aria-expanded={showCapabilities}
          title="Browser, tools, MCP, skills, plugins, and subagents"
          onClick={() => setShowCapabilities((current) => !current)}
          className="hover:bg-list-hover focus-visible:ring-border-focus flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1"
        >
          <SquaresPlusIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={
            showWideNavigation
              ? "Hide agents and chats"
              : "Show agents and chats"
          }
          aria-expanded={showWideNavigation}
          title={
            showWideNavigation
              ? "Hide agents and chats"
              : "Show agents and chats"
          }
          onClick={() => setShowWideNavigation((current) => !current)}
          className="hover:bg-list-hover focus-visible:ring-border-focus hidden h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent outline-none focus-visible:ring-1 min-[720px]:flex"
        >
          <QueueListIcon className="h-3.5 w-3.5" />
        </button>
        {showCapabilities && (
          <div
            role="menu"
            aria-label="Agent capabilities menu"
            className="qivryn-agent-capabilities-menu border-input bg-background absolute right-2 top-9 z-[70] w-[min(256px,calc(100vw-16px))] overflow-hidden rounded-lg border p-1 shadow-xl"
          >
            {[
              {
                label: "Browser & computer use",
                title: "Open an auditable local browser session",
                Icon: CursorArrowRaysIcon,
                action: () =>
                  navigate(
                    selected
                      ? `${ROUTES.BROWSER}?runId=${encodeURIComponent(selected.id)}`
                      : ROUTES.BROWSER,
                  ),
              },
              {
                label: "Tools & MCP",
                title: "Configure built-in and MCP tools",
                Icon: WrenchScrewdriverIcon,
                action: () => navigate(`${ROUTES.CONFIG}?tab=tools`),
              },
              {
                label: "Skills & plugins",
                title: "Install and manage local capabilities",
                Icon: SquaresPlusIcon,
                action: () => navigate(`${ROUTES.CONFIG}?tab=extensions`),
              },
              {
                label: "Scheduled tasks",
                title: "Schedule recurring agent work",
                Icon: ClockIcon,
                action: () => setShowAutomations(true),
              },
              {
                label: "New subagent",
                title: "Start a child task with inherited context",
                Icon: PlusIcon,
                action: () => {
                  if (selected) void openCreate(selected.id);
                },
                disabled: !selected,
              },
            ]
              .filter(({ disabled }) => !disabled)
              .map(({ label, title, Icon, action }) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  title={title}
                  onClick={() => {
                    setShowCapabilities(false);
                    action();
                  }}
                  className="hover:bg-list-hover grid h-9 w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-md border-none bg-transparent px-2 text-left"
                >
                  <span className="flex h-6 w-6 items-center justify-center">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 truncate text-xs">{label}</span>
                </button>
              ))}
          </div>
        )}
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
        {!isQivrynStandalone() && (
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
        )}
        {isQivrynStandalone() && (
          <button
            type="button"
            aria-label="Reload Agents window"
            title="Reload Agents window and release any active edit"
            onClick={() =>
              ideMessenger.post("reloadAgentWindow", {
                path: ROUTES.AGENTS,
              } as any)
            }
            className="hover:bg-list-hover focus-visible:ring-border-focus relative z-20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs outline-none focus-visible:ring-1"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            <span className="hidden min-[520px]:inline">Reload</span>
          </button>
        )}
        {!isQivrynStandalone() && (
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
        )}
      </header>

      {showAutomations && (
        <AgentAutomationsPanel
          defaultRepository={newRepository}
          onClose={() => setShowAutomations(false)}
          onRunStarted={() => {
            setShowWideNavigation(true);
            void loadRuns(false);
          }}
          onOpenRun={(runId) => {
            setShowAutomations(false);
            setShowCreateComposer(false);
            setSelectedChatId(undefined);
            setSelectedId(runId);
            setShowWideNavigation(true);
            void loadRuns(false);
          }}
        />
      )}

      <div
        className="cursor-agent-shell-grid grid min-h-0 min-w-0 flex-1 grid-cols-1"
        data-wide-navigation-open={showWideNavigation ? "true" : "false"}
      >
        <aside
          aria-label="Agents and chats"
          className={`cursor-agents-sidebar flex min-h-0 min-w-0 flex-col border-r ${
            selected ||
            selectedChat ||
            (runs.length === 0 && chatSessions.length === 0)
              ? "max-[719px]:hidden"
              : ""
          }`}
        >
          <nav
            className="qivryn-codex-sidebar-nav"
            aria-label="Qivryn navigation"
          >
            <div className="qivryn-codex-sidebar-brand">
              <span>Qivryn</span>
              <span className="qivryn-codex-sidebar-brand-accent">Code</span>
            </div>
            <button type="button" onClick={() => void openCreate(undefined)}>
              <PlusIcon className="h-4 w-4" />
              <span>New task</span>
            </button>
            <button type="button" onClick={() => setShowAutomations(true)}>
              <ClockIcon className="h-4 w-4" />
              <span>Scheduled</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.CONFIG}?tab=extensions`)}
            >
              <SquaresPlusIcon className="h-4 w-4" />
              <span>Plugins</span>
            </button>
            <button type="button" onClick={() => navigate(ROUTES.BROWSER)}>
              <CursorArrowRaysIcon className="h-4 w-4" />
              <span>Browser</span>
            </button>
            <button type="button" onClick={() => navigate(ROUTES.HOME)}>
              <ChatBubbleLeftRightIcon className="h-4 w-4" />
              <span>Chat</span>
            </button>
          </nav>

          <div className="cursor-agent-sidebar-search relative mx-3 mt-3 flex-shrink-0">
            <MagnifyingGlassIcon className="text-description pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              ref={searchRef}
              aria-label="Search agents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                showArchived
                  ? "Search archived agents"
                  : "Search agents and chats"
              }
              className="border-input bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus box-border w-full rounded-md border py-2 pl-7 pr-8 text-xs outline-none"
            />
            <button
              type="button"
              aria-label={
                showArchived ? "Hide archived agents" : "Show archived agents"
              }
              aria-pressed={showArchived}
              title={
                showArchived ? "Back to active agents" : "Show archived agents"
              }
              onClick={() => {
                setShowArchived((current) => !current);
                setSelectedId(undefined);
                setSelectedChatId(undefined);
              }}
              className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded border-none bg-transparent ${showArchived ? "text-link" : "text-description hover:text-foreground"}`}
            >
              <ArchiveBoxIcon className="h-3.5 w-3.5" />
            </button>
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
                      : showArchived
                        ? "No archived agents."
                        : "No agent runs or chat sessions yet."}
                  </div>
                  {!query && !showArchived && (
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
                  {showArchived ? "Archived" : "Recent"}
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
                      setShowWideNavigation(false);
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
          className="cursor-agents-main min-h-0 min-w-0 overflow-hidden"
        >
          {selected && (
            <AgentDetails
              key={selected.id}
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
                void control({
                  action:
                    selected.status === "archived" ? "unarchive" : "archive",
                  runId: selected.id,
                }).then((success) => success && setSelectedId(undefined))
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
              onQueue={async (prompt, behavior) => {
                const success = await control({
                  action: "queue.add",
                  runId: selected.id,
                  prompt,
                  behavior,
                });
                await reloadQueue();
                if (!success) return false;
                if (
                  AGENT_FOLLOW_UP_RESUME_STATUSES.has(
                    await latestRunStatus(selected.id, selected.status),
                  )
                ) {
                  const resumed = await control({
                    action: "run.resume",
                    runId: selected.id,
                  });
                  await reloadQueue();
                  return resumed;
                }
                return true;
              }}
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
                  text: formatQivrynDeepLink({
                    type: "agent",
                    runId: selected.id,
                  }),
                })
              }
              onCopyCheckpointLink={(checkpointId) =>
                void ideMessenger.request("copyText", {
                  text: formatQivrynDeepLink({
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
              onResolveApproval={(approvalId, decision) =>
                void control({
                  action: "approval.resolve",
                  runId: selected.id,
                  approvalId,
                  decision,
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
          {!selected &&
            !selectedChat &&
            showCreateComposer &&
            newParentRunId && (
              <div className="qivryn-codex-new-task flex h-full min-h-64 items-center justify-center px-5 py-8">
                <div className="w-full max-w-3xl">
                  <div className="qivryn-codex-new-task-heading">
                    <h1>
                      {newParentRunId
                        ? "What should this subagent work on?"
                        : effectiveNewRepository
                          ? `What should we work on in ${repositoryDisplayName(effectiveNewRepository)}?`
                          : "What should we work on?"}
                    </h1>
                    <p>
                      {newParentRunId
                        ? `Continue from ${runs.find((run) => run.id === newParentRunId)?.title ?? "the parent agent"} with inherited context.`
                        : "Start a durable task in this workspace or an isolated worktree."}
                    </p>
                  </div>
                  <form
                    className="qivryn-codex-task-composer"
                    aria-label="Create agent"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createRun();
                    }}
                  >
                    <textarea
                      ref={newTaskRef}
                      aria-label="Agent task"
                      value={newPrompt}
                      onChange={(event) => setNewPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      placeholder="Ask Qivryn to build, review, debug, or investigate"
                      rows={4}
                    />
                    {!newParentRunId && newTaskCount > MAX_PARALLEL_TASKS && (
                      <div role="alert" className="text-error px-1 text-[11px]">
                        Up to {MAX_PARALLEL_TASKS} parallel tasks are supported.
                        Remove {newTaskCount - MAX_PARALLEL_TASKS} to continue.
                      </div>
                    )}
                    {(newRuntime === "docker" || newRuntime === "ssh") && (
                      <div className="qivryn-codex-task-runtime-options">
                        {newRuntime === "docker" ? (
                          <input
                            aria-label="Container image"
                            value={newContainerImage}
                            onChange={(event) =>
                              setNewContainerImage(event.target.value)
                            }
                            placeholder="Container image"
                          />
                        ) : (
                          <input
                            aria-label="SSH host"
                            value={newSshHost}
                            onChange={(event) =>
                              setNewSshHost(event.target.value)
                            }
                            placeholder="user@host"
                          />
                        )}
                      </div>
                    )}
                    <div className="qivryn-codex-task-composer-footer">
                      <div className="qivryn-agent-composer-tools flex min-w-0 items-center gap-1.5">
                        <ModeSelect
                          skillName={newSkill}
                          onSkillChange={setNewSkill}
                          agentAccessMode={newPermissionMode}
                          onAgentAccessModeChange={setNewPermissionMode}
                          agentRuntime={newRuntime}
                          onAgentRuntimeChange={setNewRuntime}
                          includeAgentControls
                        />
                        <AgentContextPicker
                          repositoryPath={effectiveNewRepository}
                          items={newContextItems}
                          onChange={setNewContextItems}
                        />
                        <div className="qivryn-composer-repository">
                          <FolderIcon className="h-3.5 w-3.5 flex-none" />
                          <input
                            aria-label="Agent repository"
                            value={newRepository || effectiveNewRepository}
                            list="agent-repository-options"
                            onChange={(event) =>
                              setNewRepository(event.target.value)
                            }
                            placeholder="Choose workspace"
                            title={
                              effectiveNewRepository || "Choose a workspace"
                            }
                          />
                          <datalist id="agent-repository-options">
                            {repositoryChoices.map((repository) => (
                              <option key={repository} value={repository} />
                            ))}
                          </datalist>
                          <button
                            type="button"
                            aria-label="Browse…"
                            title="Choose repository"
                            onClick={() => void chooseRepository()}
                          >
                            <EllipsisHorizontalIcon className="h-3.5 w-3.5" />
                          </button>
                          {newRepository.trim() && (
                            <button
                              type="button"
                              aria-label="Clear repository override"
                              title="Use current workspace"
                              onClick={clearRepository}
                            >
                              <XMarkIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="qivryn-agent-composer-submit-cluster">
                        <VoiceInputButton
                          disabled={starting}
                          onInsert={(text) =>
                            setNewPrompt((current) =>
                              appendVoiceTranscript(current, text),
                            )
                          }
                        />
                        <ModeSelect modelOnly />
                        <button
                          type="submit"
                          aria-label={
                            starting
                              ? "Starting"
                              : !newParentRunId && newTaskCount > 1
                                ? `Start ${newTaskCount}`
                                : "Start"
                          }
                          disabled={
                            starting ||
                            !newPrompt.trim() ||
                            !effectiveNewRepository.trim() ||
                            (!newParentRunId &&
                              newTaskCount > MAX_PARALLEL_TASKS) ||
                            (newRuntime === "ssh" && !newSshHost.trim())
                          }
                          className="qivryn-codex-send-button"
                        >
                          <ArrowUpIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
          {!selected &&
            !selectedChat &&
            !showCreateComposer &&
            !showAutomations && (
              <div
                className="flex h-full min-h-64 items-center justify-center px-5 py-8"
                aria-live="polite"
              >
                {showWideNavigation ? (
                  <div className="text-description max-w-sm text-center text-xs leading-5">
                    <p className="m-0">
                      Select an agent or chat from the session panel.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(ROUTES.HOME, { replace: true })}
                      className="hover:text-foreground text-link mt-3 cursor-pointer border-none bg-transparent p-0 text-xs"
                    >
                      Open composer
                    </button>
                  </div>
                ) : (
                  <span className="text-description text-xs">
                    Opening the unified composer...
                  </span>
                )}
              </div>
            )}
        </main>
      </div>
    </div>
  );
}
