import {
  ChatBubbleOvalLeftIcon,
  ChevronDoubleUpIcon,
} from "@heroicons/react/24/outline";
import type { AgentRun } from "@qivryn/agent-runtime/contracts";
import { Editor, JSONContent } from "@tiptap/react";
import { ChatHistoryItem, ContextItemWithId, InputModifiers } from "core";
import { renderChatMessage, stripImages } from "core/util/messageContent";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import { v4 as uuidv4 } from "uuid";
import styled from "styled-components";
import { Button, lightGray, vscBackground } from "../../components";
import { useFindWidget } from "../../components/find/FindWidget";
import TimelineItem from "../../components/gui/TimelineItem";
import ThinkingBlockPeek from "../../components/mainInput/belowMainInput/ThinkingBlockPeek";
import QivrynInputBox from "../../components/mainInput/QivrynInputBox";
import StepContainer from "../../components/StepContainer";
import { TabBar } from "../../components/TabBar/TabBar";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  selectDoneApplyStates,
  selectPendingToolCalls,
} from "../../redux/selectors/selectToolCalls";
import {
  cancelToolCall,
  ChatHistoryItemWithMessageId,
  newSession,
  setInactive,
  setSessionChatModelTitle,
  submitEditorAndInitAtIndex,
  updateToolCallOutput,
  updateHistoryItemAtIndex,
} from "../../redux/slices/sessionSlice";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { streamEditThunk } from "../../redux/thunks/edit";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { isJetBrains, isMetaEquivalentKeyPressed } from "../../util";
import { ToolCallDiv } from "./ToolCallDiv";

import { useStore } from "react-redux";
import FeedbackDialog from "../../components/dialogs/FeedbackDialog";

import { FatalErrorIndicator } from "../../components/config/FatalErrorNotice";
import { RuntimeRecoveryActions } from "../../components/RuntimeRecoveryActions";
import InlineErrorMessage from "../../components/mainInput/InlineErrorMessage";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { RootState } from "../../redux/store";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { cancelActiveApply } from "../../redux/thunks/cancelActiveApply";
import { getLocalStorage, setLocalStorage } from "../../util/localStorage";
import { EmptyChatBody } from "./EmptyChatBody";
import { ExploreDialogWatcher } from "./ExploreDialogWatcher";
import { useAutoScroll } from "./useAutoScroll";

// Helper function to find the index of the latest conversation summary
function findLatestSummaryIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationSummary) {
      return i;
    }
  }
  return -1; // No summary found
}

const StepsDiv = styled.div`
  position: relative;
  background-color: transparent;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;

  & > * {
    position: relative;
  }
`;

const MAIN_COMPOSER_MAX_PARALLEL_AGENT_TASKS = 12;
const MAIN_COMPOSER_CONTEXT_SNAPSHOT_CHARS = 6_000;
const LAST_AGENT_REPOSITORY_KEY = "qivryn.agents.lastRepository";
const AGENT_REPOSITORY_CHANGED_EVENT = "qivryn:agent-repository-changed";

function parseMainComposerAgentTasks(value: string): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (
    /^(?:run in parallel|agent task|background task):?$/i.test(lines[0] ?? "")
  ) {
    return lines.slice(1);
  }
  return lines;
}

function editorStateToPlainText(value: JSONContent | undefined): string {
  if (!value) return "";
  if (typeof value.text === "string") return value.text;
  const childText = value.content?.map(editorStateToPlainText).filter(Boolean);
  if (!childText?.length) return "";
  return value.type === "doc" ? childText.join("\n") : childText.join("");
}

function shouldUseDurableAgentComposer(
  editorState: JSONContent,
  history: ChatHistoryItem[],
): boolean {
  if (getLastComposerAgentRunId(history)) {
    return true;
  }
  const text = editorStateToPlainText(editorState).trim();
  return /^(?:run in parallel|agent task|background task):/i.test(text);
}

function normalizeMainComposerPath(value: string): string {
  if (value.startsWith("file:")) {
    try {
      const uri = new URL(value);
      return decodeURIComponent(uri.pathname).replace(/\\/g, "/");
    } catch {
      return value.replace(/^file:\/\//, "").replace(/\\/g, "/");
    }
  }
  return value.replace(/\\/g, "/");
}

function selectedMainComposerRepositoryPath(
  workspaceDirs: string[] | undefined,
): string | undefined {
  const selected = window.localStorage
    .getItem(LAST_AGENT_REPOSITORY_KEY)
    ?.trim();
  const candidate =
    selected || workspaceDirs?.[0] || window.workspacePaths?.[0];
  if (!candidate) return undefined;
  return normalizeMainComposerPath(candidate);
}

function repositoryRelativePath(
  repositoryPath: string,
  candidatePath: string,
): string | undefined {
  const repository = normalizeMainComposerPath(repositoryPath).replace(
    /\/$/,
    "",
  );
  const candidate = normalizeMainComposerPath(candidatePath).replace(
    /^\.\//,
    "",
  );
  if (!candidate) return undefined;
  if (!candidate.startsWith("/") && !/^[A-Za-z]:\//.test(candidate)) {
    return candidate;
  }
  const prefix = `${repository}/`;
  if (!candidate.startsWith(prefix)) return undefined;
  return candidate.slice(prefix.length);
}

function renderAgentContextForPrompt(
  prompt: string,
  repositoryPath: string,
  contextItems: ContextItemWithId[],
): string {
  const fileReferences = new Set<string>();
  const snapshots: string[] = [];

  for (const item of contextItems) {
    const uriValue = item.uri?.value;
    if (item.uri?.type === "file" && uriValue) {
      const reference = repositoryRelativePath(repositoryPath, uriValue);
      if (reference) fileReferences.add(reference);
      continue;
    }

    const content =
      typeof item.content === "string" ? item.content.trim() : undefined;
    if (!content) continue;
    const label =
      item.name ||
      item.description ||
      item.id?.itemId ||
      item.id?.providerTitle;
    const bounded =
      content.length <= MAIN_COMPOSER_CONTEXT_SNAPSHOT_CHARS
        ? content
        : `[Older snapshot output omitted; ${content.length.toLocaleString()} characters total.]\n${content.slice(-MAIN_COMPOSER_CONTEXT_SNAPSHOT_CHARS)}`;
    snapshots.push(
      `<context_snapshot label=${JSON.stringify(label ?? "context")}>\n${bounded}\n</context_snapshot>`,
    );
  }

  let result = prompt;
  if (fileReferences.size > 0) {
    result += `\n\n<context_files>\nRead these repository-relative files as relevant before responding:\n${[
      ...fileReferences,
    ]
      .map((file) => `- ${JSON.stringify(file)}`)
      .join("\n")}\n</context_files>`;
  }
  if (snapshots.length > 0) {
    result += `\n\n${snapshots.join("\n\n")}`;
  }
  return result;
}

function renderAgentLaunchMessage(
  tasks: string[],
  runs: AgentRun[],
  repositoryPath: string,
): string {
  const taskLabel =
    tasks.length === 1
      ? "Started a durable agent task from this composer."
      : `Started ${runs.length} durable agent tasks from this composer.`;
  const taskLines =
    tasks.length === 1
      ? `\n\nTask: ${tasks[0]}`
      : `\n\n${tasks.map((task, index) => `${index + 1}. ${task}`).join("\n")}`;
  const workspaceName =
    repositoryPath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || repositoryPath;

  return `${taskLabel}${taskLines}\n\nWorkspace: \`${workspaceName}\`\n\nThe task keeps running if you switch chats. Continue steering it from the composer while it is active.`;
}

function renderAgentSteeringMessage(runId: string): string {
  return `Queued a steering message for the active durable agent.\n\nRun: \`${runId}\``;
}

function getLastComposerAgentRunId(
  history: ChatHistoryItem[],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index].message;
    if (message.role !== "assistant") {
      continue;
    }
    const metadata = message.metadata as
      | { qivrynComposerAgentRunIds?: unknown }
      | undefined;
    const runIds = metadata?.qivrynComposerAgentRunIds;
    if (
      Array.isArray(runIds) &&
      runIds.length === 1 &&
      typeof runIds[0] === "string"
    ) {
      return runIds[0];
    }
  }
  return undefined;
}

export const MAIN_EDITOR_INPUT_ID = "main-editor-input";
const INITIAL_RENDERED_HISTORY_ITEMS = 60;
const CONTINUE_INCOMPLETE_RESPONSE_PROMPT =
  "Continue your previous response exactly from where it stopped. Do not repeat completed content.";

function createPlainTextEditorState(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

export function measureScrollbarInset(
  element: Pick<HTMLElement, "clientWidth" | "offsetWidth">,
): number {
  return Math.max(0, element.offsetWidth - element.clientWidth);
}

function fallbackRender({ error, resetErrorBoundary }: any) {
  // Call resetErrorBoundary() to reset the error boundary and retry the render.

  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <pre style={{ color: lightGray }}>{error.stack}</pre>

      <RuntimeRecoveryActions onRetry={resetErrorBoundary} />
    </div>
  );
}

export function Chat() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const reduxStore = useStore<RootState>();
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [stepsOpen] = useState<(boolean | undefined)[]>([]);
  const mainTextInputRef = useRef<HTMLInputElement>(null);
  const stepsDivRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const history = useAppSelector((state) => state.session.history);
  const sessionId = useAppSelector((state) => state.session.id);
  const [visibleHistoryLimit, setVisibleHistoryLimit] = useState(
    INITIAL_RENDERED_HISTORY_ITEMS,
  );
  const [scrollbarInset, setScrollbarInset] = useState(0);
  const showChatScrollbar = useAppSelector(
    (state) => state.config.config.ui?.showChatScrollbar,
  );
  const codeToEdit = useAppSelector((state) => state.editModeState.codeToEdit);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);

  const hasDismissedExploreDialog = useAppSelector(
    (state) => state.ui.hasDismissedExploreDialog,
  );
  const jetbrains = useMemo(() => {
    return isJetBrains();
  }, []);

  useAutoScroll(stepsDivRef, history);

  useEffect(() => {
    const element = stepsDivRef.current;
    if (!element) return;

    const updateScrollbarInset = () => {
      const nextInset = measureScrollbarInset(element);
      setScrollbarInset((currentInset) =>
        currentInset === nextInset ? currentInset : nextInset,
      );
    };

    updateScrollbarInset();
    const observer = new ResizeObserver(updateScrollbarInset);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setVisibleHistoryLimit(INITIAL_RENDERED_HISTORY_ITEMS);
  }, [sessionId]);

  const latestSummaryIndex = useMemo(
    () => findLatestSummaryIndex(history),
    [history],
  );
  const lastUserInputIndex = useMemo(() => {
    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index].message.role === "user") return index;
    }
    return -1;
  }, [history]);
  const renderableHistory = useMemo(() => {
    const entries = history
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.message.role !== "system");
    return {
      hiddenCount: Math.max(0, entries.length - visibleHistoryLimit),
      entries: entries.slice(-visibleHistoryLimit),
    };
  }, [history, visibleHistoryLimit]);
  const earlierItemsToReveal = Math.min(
    INITIAL_RENDERED_HISTORY_ITEMS,
    renderableHistory.hiddenCount,
  );

  useEffect(() => {
    // Cmd + Backspace to delete current step
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        (jetbrains ? e.altKey : isMetaEquivalentKeyPressed(e)) &&
        !e.shiftKey
      ) {
        void dispatch(cancelActiveApply());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isStreaming, jetbrains, isInEdit]);

  const { widget, highlights } = useFindWidget(
    stepsDivRef,
    tabsRef,
    isStreaming,
  );

  const startDurableAgentFromComposer = useCallback(
    async (
      editorState: JSONContent,
      modifiers: InputModifiers,
      editorToClearOnSend?: Editor,
    ): Promise<boolean> => {
      const stateSnapshot = reduxStore.getState();
      const workspaceResponse = await ideMessenger.request(
        "getWorkspaceDirs",
        undefined,
      );
      const repositoryPath = selectedMainComposerRepositoryPath(
        workspaceResponse.status === "success"
          ? workspaceResponse.content
          : undefined,
      );
      if (!repositoryPath) {
        throw new Error(
          "No workspace is open. Open a folder before starting an agent task.",
        );
      }
      window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, repositoryPath);
      window.dispatchEvent(
        new CustomEvent(AGENT_REPOSITORY_CHANGED_EVENT, {
          detail: repositoryPath,
        }),
      );

      const defaultContextProviders =
        stateSnapshot.config.config.experimental?.defaultContext ?? [];
      const resolved = await resolveEditorContent({
        editorState,
        modifiers,
        ideMessenger,
        defaultContextProviders,
        availableSlashCommands: stateSnapshot.config.config.slashCommands,
        dispatch,
        getState: () => reduxStore.getState(),
      });
      const prompt = stripImages(resolved.content).trim();
      const tasks = parseMainComposerAgentTasks(prompt);
      if (
        tasks.length === 0 ||
        tasks.length > MAIN_COMPOSER_MAX_PARALLEL_AGENT_TASKS
      ) {
        throw new Error(
          tasks.length > MAIN_COMPOSER_MAX_PARALLEL_AGENT_TASKS
            ? `Up to ${MAIN_COMPOSER_MAX_PARALLEL_AGENT_TASKS} parallel agent tasks are supported.`
            : "Enter a task before starting an agent.",
        );
      }

      const selectedChatModel = selectSelectedChatModel(stateSnapshot);
      if (!selectedChatModel) {
        throw new Error("No chat model selected");
      }

      const inputIndex = stateSnapshot.session.history.length;
      dispatch(submitEditorAndInitAtIndex({ index: inputIndex, editorState }));
      dispatch(setSessionChatModelTitle(selectedChatModel.title));
      dispatch(
        updateHistoryItemAtIndex({
          index: inputIndex,
          updates: {
            message: {
              role: "user",
              content: resolved.content,
              id: uuidv4(),
            },
            contextItems: resolved.selectedContextItems,
          },
        }),
      );

      if (editorToClearOnSend) {
        editorToClearOnSend.commands.clearContent();
      }

      const reasoningEffort = selectedChatModel?.title
        ? stateSnapshot.ui.reasoningEffortSettings[selectedChatModel.title]
        : undefined;
      const lastComposerAgentRunId =
        tasks.length === 1
          ? getLastComposerAgentRunId(stateSnapshot.session.history)
          : undefined;
      if (lastComposerAgentRunId) {
        const response = await ideMessenger.request("agents/control", {
          action: "queue.add",
          runId: lastComposerAgentRunId,
          prompt: renderAgentContextForPrompt(
            tasks[0],
            repositoryPath,
            resolved.selectedContextItems,
          ),
          behavior: "steer",
        });
        if (response.status !== "success") {
          dispatch(
            updateHistoryItemAtIndex({
              index: inputIndex + 1,
              updates: {
                message: {
                  role: "assistant",
                  content: `Agent steering message could not be queued: ${response.error}`,
                  id: uuidv4(),
                },
              },
            }),
          );
          dispatch(setInactive());
          throw new Error(response.error);
        }
        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex + 1,
            updates: {
              message: {
                role: "assistant",
                content: renderAgentSteeringMessage(lastComposerAgentRunId),
                id: uuidv4(),
                metadata: {
                  qivrynComposerAgentRunIds: [lastComposerAgentRunId],
                },
              },
            },
          }),
        );
        dispatch(setInactive());
        return true;
      }

      let responses: Awaited<ReturnType<typeof ideMessenger.request>>[];
      try {
        responses = await Promise.all(
          tasks.map((task) =>
            ideMessenger.request("agents/control", {
              action: "run.create",
              request: {
                prompt: renderAgentContextForPrompt(
                  task,
                  repositoryPath,
                  resolved.selectedContextItems,
                ),
                model: selectedChatModel.title,
                permissionMode:
                  stateSnapshot.ui.agentAccessMode ?? "autonomous",
                workspace: {
                  location: "local",
                  repositoryPath,
                },
                metadata: {
                  source: "main-composer",
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                },
              },
            }),
          ),
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex + 1,
            updates: {
              message: {
                role: "assistant",
                content: `Agent task could not start: ${message}`,
                id: uuidv4(),
              },
            },
          }),
        );
        dispatch(setInactive());
        throw cause;
      }
      const firstSuccess = responses.find(
        (response) => response.status === "success",
      );
      if (!firstSuccess || firstSuccess.status !== "success") {
        const firstFailure = responses.find(
          (response) => response.status === "error",
        );
        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex + 1,
            updates: {
              message: {
                role: "assistant",
                content:
                  firstFailure?.status === "error"
                    ? `Agent task could not start: ${firstFailure.error}`
                    : "The agent task could not be started.",
                id: uuidv4(),
              },
            },
          }),
        );
        dispatch(setInactive());
        throw new Error(
          firstFailure?.status === "error"
            ? firstFailure.error
            : "The agent task could not be started.",
        );
      }

      const runs: AgentRun[] = [];
      for (const response of responses) {
        if (response.status === "success") {
          runs.push(response.content as AgentRun);
        }
      }
      dispatch(
        updateHistoryItemAtIndex({
          index: inputIndex + 1,
          updates: {
            message: {
              role: "assistant",
              content: renderAgentLaunchMessage(tasks, runs, repositoryPath),
              id: uuidv4(),
              metadata: {
                qivrynComposerAgentRunIds: runs.map((run) => run.id),
              },
            },
          },
        }),
      );
      dispatch(setInactive());
      return true;
    },
    [dispatch, ideMessenger, reduxStore],
  );

  const sendInput = useCallback(
    (
      editorState: JSONContent,
      modifiers: InputModifiers,
      index?: number,
      editorToClearOnSend?: Editor,
    ) => {
      const stateSnapshot = reduxStore.getState();
      const latestPendingToolCalls = selectPendingToolCalls(stateSnapshot);
      const latestPendingApplyStates = selectDoneApplyStates(stateSnapshot);
      const isCurrentlyInEdit = stateSnapshot.session.isInEdit;
      const codeToEditSnapshot = stateSnapshot.editModeState.codeToEdit;

      // Cancel all pending tool calls
      latestPendingToolCalls.forEach((toolCallState) => {
        dispatch(
          cancelToolCall({
            toolCallId: toolCallState.toolCallId,
          }),
        );
      });

      // Reject all pending apply states
      latestPendingApplyStates.forEach((applyState) => {
        if (applyState.status !== "closed") {
          ideMessenger.post("rejectDiff", applyState);
        }
      });
      if (isCurrentlyInEdit && codeToEditSnapshot.length === 0) {
        return;
      }

      if (isCurrentlyInEdit) {
        void dispatch(
          streamEditThunk({
            editorState,
            codeToEdit: codeToEditSnapshot,
          }),
        );
      } else if (
        shouldUseDurableAgentComposer(
          editorState,
          stateSnapshot.session.history,
        )
      ) {
        void startDurableAgentFromComposer(
          editorState,
          modifiers,
          editorToClearOnSend,
        ).catch((cause) => {
          dispatch(
            setDialogMessage(
              <div className="p-4">
                <h3 className="text-error m-0 text-sm font-semibold">
                  Agent task could not start
                </h3>
                <p className="text-description mt-2 text-sm">
                  {cause instanceof Error ? cause.message : String(cause)}
                </p>
              </div>,
            ),
          );
          dispatch(setShowDialog(true));
        });
      } else {
        void dispatch(streamResponseThunk({ editorState, modifiers, index }));

        if (editorToClearOnSend) {
          editorToClearOnSend.commands.clearContent();
        }
      }

      // Increment localstorage counter for popup
      const currentCount = getLocalStorage("mainTextEntryCounter");
      if (currentCount) {
        setLocalStorage("mainTextEntryCounter", currentCount + 1);
        if (currentCount === 300) {
          dispatch(setDialogMessage(<FeedbackDialog />));
          dispatch(setShowDialog(true));
        }
      } else {
        setLocalStorage("mainTextEntryCounter", 1);
      }
    },
    [dispatch, ideMessenger, reduxStore, startDurableAgentFromComposer],
  );

  useWebviewListener(
    "newSession",
    async () => {
      // unwrapResult(response) // errors if session creation failed
      mainTextInputRef.current?.focus?.();
    },
    [mainTextInputRef],
  );

  // Handle partial tool call output for streaming updates
  useWebviewListener(
    "toolCallPartialOutput",
    async (data) => {
      // Update tool call output in Redux store
      dispatch(
        updateToolCallOutput({
          toolCallId: data.toolCallId,
          contextItems: data.contextItems,
        }),
      );
    },
    [dispatch],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => index === lastUserInputIndex,
    [lastUserInputIndex],
  );

  const renderChatHistoryItem = useCallback(
    (item: ChatHistoryItemWithMessageId, index: number) => {
      const {
        message,
        editorState,
        contextItems,
        appliedRules,
        toolCallStates,
      } = item;

      const isBeforeLatestSummary =
        latestSummaryIndex !== -1 && index < latestSummaryIndex;

      if (message.role === "user") {
        return (
          <QivrynInputBox
            onEnter={(editorState, modifiers) =>
              sendInput(editorState, modifiers, index)
            }
            isLastUserInput={isLastUserInput(index)}
            isMainInput={false}
            editorState={editorState ?? item.message.content}
            contextItems={contextItems}
            appliedRules={appliedRules}
            inputId={message.id}
            showMessageActions
          />
        );
      }

      if (message.role === "tool") {
        return null;
      }

      if (message.role === "assistant") {
        return (
          <>
            {/* Always render assistant content through normal path */}
            <div className="qivryn-assistant-message thread-message">
              <TimelineItem
                item={item}
                iconElement={
                  <ChatBubbleOvalLeftIcon width="16px" height="16px" />
                }
                open={
                  typeof stepsOpen[index] === "undefined"
                    ? true
                    : stepsOpen[index]!
                }
                onToggle={() => {}}
              >
                <StepContainer
                  index={index}
                  isLast={index === history.length - 1}
                  item={item}
                  latestSummaryIndex={latestSummaryIndex}
                  onContinueFromIncomplete={() =>
                    sendInput(
                      createPlainTextEditorState(
                        CONTINUE_INCOMPLETE_RESPONSE_PROMPT,
                      ),
                      { useCodebase: false, noContext: true },
                    )
                  }
                />
              </TimelineItem>
            </div>

            {toolCallStates && (
              <ToolCallDiv
                toolCallStates={toolCallStates}
                historyIndex={index}
              />
            )}
          </>
        );
      }

      if (message.role === "thinking") {
        const thinkingContent = renderChatMessage(message);
        if (!thinkingContent?.trim()) {
          return null;
        }
        return (
          <div className={isBeforeLatestSummary ? "opacity-50" : ""}>
            <ThinkingBlockPeek
              content={thinkingContent}
              redactedThinking={message.redactedThinking}
              index={index}
              prevItem={index > 0 ? history[index - 1] : null}
              inProgress={index === history.length - 1 && isStreaming}
              signature={message.signature}
            />
          </div>
        );
      }

      // Default case - regular assistant message
      return (
        <div className="qivryn-assistant-message thread-message">
          <TimelineItem
            item={item}
            iconElement={<ChatBubbleOvalLeftIcon width="16px" height="16px" />}
            open={
              typeof stepsOpen[index] === "undefined" ? true : stepsOpen[index]!
            }
            onToggle={() => {}}
          >
            <StepContainer
              index={index}
              isLast={index === history.length - 1}
              item={item}
              latestSummaryIndex={latestSummaryIndex}
              onContinueFromIncomplete={() =>
                sendInput(
                  createPlainTextEditorState(
                    CONTINUE_INCOMPLETE_RESPONSE_PROMPT,
                  ),
                  { useCodebase: false, noContext: true },
                )
              }
            />
          </TimelineItem>
        </div>
      );
    },
    [
      sendInput,
      isLastUserInput,
      history,
      stepsOpen,
      isStreaming,
      latestSummaryIndex,
    ],
  );

  const showScrollbar = showChatScrollbar ?? window.innerHeight > 5000;
  return (
    <>
      {!!showSessionTabs && !isInEdit && <TabBar ref={tabsRef} />}
      {widget}

      <StepsDiv
        ref={stepsDivRef}
        className={`qivryn-chat-scroll pt-[8px] ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} min-h-0 flex-1 ${history.length > 0 ? "overflow-y-scroll" : "overflow-y-auto"}`}
      >
        {history.length === 0 ? (
          <div
            className="qivryn-thread-rail qivryn-empty-thread-rail"
            data-testid="qivryn-thread-rail"
          >
            <EmptyChatBody />
          </div>
        ) : (
          <div className="qivryn-thread-rail" data-testid="qivryn-thread-rail">
            {highlights}
            {renderableHistory.hiddenCount > 0 && (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  data-testid="show-earlier-history"
                  className="qivryn-history-load-button"
                  aria-label={`Show ${earlierItemsToReveal} earlier items`}
                  title={`Show ${earlierItemsToReveal} earlier items`}
                  onClick={() =>
                    setVisibleHistoryLimit((current) =>
                      Math.min(
                        history.length,
                        current + INITIAL_RENDERED_HISTORY_ITEMS,
                      ),
                    )
                  }
                >
                  <ChevronDoubleUpIcon
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                  />
                  <span aria-hidden="true">+{earlierItemsToReveal}</span>
                </button>
              </div>
            )}
            {renderableHistory.entries.map(({ item, index }) => (
              <div
                key={item.message.id}
                className="qivryn-history-item-wrap"
                style={{
                  minHeight: index === history.length - 1 ? "200px" : 0,
                }}
              >
                <ErrorBoundary
                  FallbackComponent={fallbackRender}
                  onReset={() => {
                    dispatch(newSession());
                  }}
                >
                  {renderChatHistoryItem(item, index)}
                </ErrorBoundary>
                {index === history.length - 1 && <InlineErrorMessage />}
              </div>
            ))}
          </div>
        )}
      </StepsDiv>
      <div
        data-testid="qivryn-chat-composer-layer"
        className="qivryn-chat-composer-layer relative z-0 min-w-0 max-w-full shrink-0 overflow-x-hidden"
        style={
          {
            "--qivryn-chat-scrollbar-inset": `${scrollbarInset}px`,
          } as CSSProperties
        }
      >
        <div
          className="qivryn-thread-rail qivryn-composer-rail"
          data-testid="qivryn-composer-rail"
        >
          <QivrynInputBox
            isMainInput
            isLastUserInput={false}
            onEnter={(editorState, modifiers, editor) =>
              sendInput(editorState, modifiers, undefined, editor)
            }
            inputId={MAIN_EDITOR_INPUT_ID}
          />

          <div
            style={{
              pointerEvents: isStreaming ? "none" : "auto",
            }}
          >
            <FatalErrorIndicator />
            {!hasDismissedExploreDialog && <ExploreDialogWatcher />}
          </div>
        </div>
      </div>
    </>
  );
}
