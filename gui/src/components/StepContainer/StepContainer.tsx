import { ChatHistoryItem } from "core";
import { renderChatMessage, stripImages } from "core/util/messageContent";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useDispatch } from "react-redux";
import { useAppSelector } from "../../redux/hooks";
import { selectUIConfig } from "../../redux/slices/configSlice";
import { markResponseContinuationRequested } from "../../redux/slices/sessionSlice";
import { hasActiveToolCalls } from "../../util/toolCallRecovery";
import ThinkingBlockPeek from "../mainInput/belowMainInput/ThinkingBlockPeek";
import StyledMarkdownPreview from "../StyledMarkdownPreview";
import ConversationSummary from "./ConversationSummary";
import ResponseActions from "./ResponseActions";
import ThinkingIndicator from "./ThinkingIndicator";

interface StepContainerProps {
  item: ChatHistoryItem;
  index: number;
  isLast: boolean;
  latestSummaryIndex?: number;
  onContinueFromIncomplete?: () => void;
}

export default function StepContainer(props: StepContainerProps) {
  const dispatch = useDispatch();
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const uiConfig = useAppSelector(selectUIConfig);

  // Calculate dimming and indicator state based on latest summary index
  const latestSummaryIndex = props.latestSummaryIndex ?? -1;
  const isBeforeLatestSummary =
    latestSummaryIndex !== -1 && props.index <= latestSummaryIndex;
  const isLatestSummary =
    latestSummaryIndex !== -1 && props.index === latestSummaryIndex;

  const historyItemAfterThis = useAppSelector(
    (state) => state.session.history[props.index + 1],
  );
  const rawContent = renderChatMessage(props.item.message);
  const markdownSource = stripImages(props.item.message.content);
  const hasRawContent = rawContent.trim().length > 0;
  const hasMarkdownContent = markdownSource.trim().length > 0;
  const hasReasoning = !!props.item.reasoning?.text?.trim();
  const hasActiveToolsForItem = hasActiveToolCalls(props.item);
  const completionStatus = props.item.message.metadata?.completionStatus;
  const isIncomplete = completionStatus === "incomplete";
  const completionReason = props.item.message.metadata?.completionReason;
  const incompleteMessage =
    completionReason === "length" || completionReason === "max_output_tokens"
      ? "Response stopped at the output limit."
      : "Response did not finish.";
  const shouldShowWorkingState =
    props.isLast && isStreaming && !props.item.isGatheringContext;
  const shouldRenderAssistantSurface = uiConfig?.displayRawMarkdown
    ? hasRawContent
    : hasReasoning ||
      hasMarkdownContent ||
      (shouldShowWorkingState && !hasActiveToolsForItem);
  const showResponseActions =
    shouldRenderAssistantSurface &&
    (props.isLast || historyItemAfterThis?.message.role === "user") &&
    !(props.isLast && (isStreaming || hasActiveToolsForItem));

  function onQivrynGeneration() {
    dispatch(markResponseContinuationRequested(props.index));
    props.onContinueFromIncomplete?.();
  }

  return (
    <div className="qivryn-step-container">
      {shouldRenderAssistantSurface && (
        <div
          className={`qivryn-assistant-surface ${isBeforeLatestSummary ? "opacity-35" : ""}`}
        >
          {uiConfig?.displayRawMarkdown ? (
            <pre className="text-2xs max-w-full overflow-x-auto whitespace-pre-wrap break-words p-4">
              {rawContent}
            </pre>
          ) : (
            <>
              {hasReasoning && (
                <ThinkingBlockPeek
                  content={props.item.reasoning!.text}
                  index={props.index}
                  prevItem={props.index > 0 ? props.item : null}
                  inProgress={!props.item.reasoning?.endAt}
                />
              )}

              {hasMarkdownContent && (
                <StyledMarkdownPreview
                  className="qivryn-assistant-markdown"
                  isRenderingInStepContainer
                  source={markdownSource}
                  itemIndex={props.index}
                  useParentBackgroundColor
                />
              )}
            </>
          )}
          {isIncomplete && !isStreaming && props.onContinueFromIncomplete && (
            <div className="qivryn-incomplete-response" role="status">
              <span>{incompleteMessage}</span>
              <button
                type="button"
                aria-label="Continue response"
                title="Continue response"
                onClick={onQivrynGeneration}
              >
                <ArrowPathIcon aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {props.isLast && <ThinkingIndicator historyItem={props.item} />}
        </div>
      )}

      {showResponseActions && (
        <div
          className={`mt-1 h-[22px] transition-opacity duration-300 ease-in-out ${isBeforeLatestSummary || isStreaming ? "opacity-35" : ""} ${isStreaming && "pointer-events-none cursor-not-allowed"}`}
        >
          <ResponseActions item={props.item} />
        </div>
      )}

      {/* Show compaction indicator for the latest summary */}
      {isLatestSummary && (
        <div className="mx-1.5 my-5">
          <div className="flex items-center">
            <div className="border-border flex-1 border-t border-solid"></div>
            <span className="text-description mx-3 text-xs">
              Previous Conversation Compacted
            </span>
            <div className="border-border flex-1 border-t border-solid"></div>
          </div>
        </div>
      )}

      {/* ConversationSummary is outside the dimmed container so it's always at full opacity */}
      <ConversationSummary item={props.item} index={props.index} />
    </div>
  );
}
