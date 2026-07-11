import {
  ChatBubbleOvalLeftIcon,
  ChevronDoubleUpIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { Editor, JSONContent } from "@tiptap/react";
import { ChatHistoryItem, InputModifiers } from "core";
import { renderChatMessage } from "core/util/messageContent";
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
import styled from "styled-components";
import { Button, lightGray, vscBackground } from "../../components";
import { useFindWidget } from "../../components/find/FindWidget";
import TimelineItem from "../../components/gui/TimelineItem";
import { NewSessionButton } from "../../components/mainInput/belowMainInput/NewSessionButton";
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
  updateToolCallOutput,
} from "../../redux/slices/sessionSlice";
import { streamEditThunk } from "../../redux/thunks/edit";
import { loadLastSession } from "../../redux/thunks/session";
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

  const lastSessionId = useAppSelector((state) => state.session.lastSessionId);
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
    [dispatch, ideMessenger, reduxStore],
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
  const showLastSessionButton =
    history.length === 0 && lastSessionId && !isInEdit;

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
            {showLastSessionButton && (
              <div className="qivryn-composer-footer flex flex-row items-center justify-between">
                <div className="xs:inline hidden">
                  <NewSessionButton
                    onClick={async () => {
                      await dispatch(loadLastSession());
                    }}
                    type="button"
                    aria-label="Open last session"
                    title="Open last session"
                    className="qivryn-last-session-button"
                  >
                    <ClockIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  </NewSessionButton>
                </div>
              </div>
            )}
            <FatalErrorIndicator />
            {!hasDismissedExploreDialog && <ExploreDialogWatcher />}
          </div>
        </div>
      </div>
    </>
  );
}
