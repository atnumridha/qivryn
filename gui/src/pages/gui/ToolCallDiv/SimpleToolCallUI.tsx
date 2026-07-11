import { Tool, ToolCallState } from "core";
import { ComponentType, useContext, useMemo, useState } from "react";
import {
  ContextItemsPeekItem,
  openContextItem,
} from "../../../components/mainInput/belowMainInput/ContextItemsPeek";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { ToggleWithIcon } from "./ToggleWithIcon";
import { ToolCallStatusMessage } from "./ToolCallStatusMessage";
import { ToolTruncateHistoryIcon } from "./ToolTruncateHistoryIcon";
import { toolCallStateToContextItems } from "./utils";

interface SimpleToolCallUIProps {
  toolCallState: ToolCallState;
  tool: Tool | undefined;
  icon?: ComponentType<React.SVGProps<SVGSVGElement>>;
  historyIndex: number;
}

export function SimpleToolCallUI({
  icon: Icon,
  toolCallState,
  tool,
  historyIndex,
}: SimpleToolCallUIProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const shownContextItems = useMemo(() => {
    const contextItems = toolCallStateToContextItems(toolCallState);
    return contextItems.filter((item) => !item.hidden);
  }, [toolCallState]);

  const [open, setOpen] = useState(false);

  const isToggleable = shownContextItems.length > 1;
  const isSingleItem = shownContextItems.length === 1;
  const shouldShowContent = isToggleable ? open : false;
  const isClickable = isToggleable || isSingleItem;

  function handleClick() {
    if (isToggleable) {
      setOpen((prev) => !prev);
    } else if (isSingleItem) {
      openContextItem(shownContextItems[0], ideMessenger);
    }
  }

  const statusContent = (
    <>
      <ToggleWithIcon
        icon={Icon}
        isToggleable={isToggleable}
        open={shouldShowContent}
        isClickable={isSingleItem}
      />
      <ToolCallStatusMessage tool={tool} toolCallState={toolCallState} />
    </>
  );

  return (
    <div className="qivryn-simple-tool-call mt-1 flex flex-col px-4">
      <div className="qivryn-tool-status-row">
        {isClickable ? (
          <button
            type="button"
            className="qivryn-tool-status-trigger"
            aria-expanded={isToggleable ? shouldShowContent : undefined}
            aria-label={
              isToggleable ? "Toggle tool results" : "Open tool result"
            }
            onClick={handleClick}
            data-testid="context-items-peek"
          >
            {statusContent}
          </button>
        ) : (
          <div
            className="qivryn-tool-status-trigger"
            data-testid="context-items-peek"
          >
            {statusContent}
          </div>
        )}

        {!!toolCallState.output?.length && (
          <ToolTruncateHistoryIcon historyIndex={historyIndex} />
        )}
      </div>

      {isToggleable && (
        <div
          className={`mt-2 overflow-y-auto transition-[max-height,opacity] duration-300 ease-in-out ${
            shouldShowContent ? "max-h-[50vh] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {shownContextItems.length > 0 ? (
            shownContextItems.map((contextItem, idx) => (
              <ContextItemsPeekItem key={idx} contextItem={contextItem} />
            ))
          ) : (
            <div className="text-description pl-5 text-xs italic">
              No tool call output
            </div>
          )}
        </div>
      )}
    </div>
  );
}
