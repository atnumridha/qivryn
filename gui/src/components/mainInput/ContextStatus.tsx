import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  selectSelectedChatModel,
  selectSelectedChatModelContextLength,
} from "../../redux/slices/configSlice";
import { saveCurrentSession } from "../../redux/thunks/session";
import {
  contextUsagePresentation,
  reconcileContextUsageSnapshot,
  type ContextUsageSnapshot,
} from "../../util/contextUsage";
import { useCompactConversation } from "../../util/compactConversation";
import { ToolTip } from "../gui/Tooltip";

export function useContextUsagePresentation(): ReturnType<
  typeof contextUsagePresentation
> & {
  usage?: ContextUsageSnapshot;
  isCompacting: boolean;
  isStale: boolean;
} {
  const configuredContextLength = useAppSelector(
    selectSelectedChatModelContextLength,
  );
  const selectedChatModel = useAppSelector(selectSelectedChatModel);
  const storedUsage = useAppSelector((state) => state.session.contextUsage);
  const isCompacting = useAppSelector(
    (state) => Object.keys(state.session.compactionLoading).length > 0,
  );
  const { usage, isStale } = reconcileContextUsageSnapshot(
    storedUsage,
    configuredContextLength,
    selectedChatModel?.model,
  );
  return {
    ...contextUsagePresentation(usage, configuredContextLength),
    usage,
    isCompacting,
    isStale,
  };
}

const ContextStatus = () => {
  const dispatch = useAppDispatch();
  const history = useAppSelector((state) => state.session.history);
  const isPruned = useAppSelector((state) => state.session.isPruned);
  const { short, accessible, percent, isCompacting, isStale } =
    useContextUsagePresentation();
  const compactConversation = useCompactConversation();

  if (history.length === 0) return null;

  const barColorClass = isPruned ? "bg-error" : "bg-description";
  const visibleLabel = isCompacting ? `Compacting · ${short}` : short;

  return (
    <ToolTip
      closeEvents={{
        mouseleave: true,
        click: true,
        mouseup: false,
      }}
      clickable
      content={
        <div className="flex max-w-64 flex-col gap-1 text-left text-xs">
          <span>{accessible}</span>
          {isStale && (
            <span>Usage will recalculate after the next message.</span>
          )}
          {isPruned && <span>Oldest messages are being removed.</span>}
          <div className="mt-1 flex flex-col gap-1 whitespace-pre">
            <span
              className="hover:text-link cursor-pointer underline"
              onClick={() => compactConversation()}
            >
              Compact conversation
            </span>
            <span
              className="hover:text-link cursor-pointer underline"
              onClick={() => {
                void dispatch(
                  saveCurrentSession({
                    openNewSession: true,
                    generateTitle: false,
                  }),
                );
              }}
            >
              Start a new session
            </span>
          </div>
        </div>
      }
    >
      <button
        type="button"
        aria-label={accessible}
        className="text-description hover:text-foreground flex max-w-44 cursor-pointer items-center gap-1.5 truncate border-none bg-transparent p-0 text-[10px]"
      >
        <span className="border-command-border relative h-[12px] w-[6px] flex-shrink-0 overflow-hidden rounded-[1px] border-[0.5px] border-solid">
          <span
            className={`absolute bottom-0 left-0 w-full transition-[height] duration-300 ease-in-out ${barColorClass}`}
            style={{ height: `${percent ?? 0}%` }}
          />
        </span>
        <span className="truncate font-mono">{visibleLabel}</span>
      </button>
    </ToolTip>
  );
};

export default ContextStatus;
