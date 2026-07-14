import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { Tool, ToolCallState } from "core";
import { useEffect, useState } from "react";
import { ToolCallStatusMessage } from "./ToolCallStatusMessage";
import { ToolTruncateHistoryIcon } from "./ToolTruncateHistoryIcon";

interface ToolCallDisplayProps {
  children: React.ReactNode;
  icon: React.ReactNode;
  tool: Tool | undefined;
  toolCallState: ToolCallState;
  historyIndex: number;
}

export function ToolCallDisplay({
  tool,
  toolCallState,
  children,
  icon,
  historyIndex,
}: ToolCallDisplayProps) {
  const isActive =
    toolCallState.status === "generating" || toolCallState.status === "calling";
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    setOpen(isActive);
  }, [isActive, toolCallState.toolCallId]);

  const statusContent = (
    <>
      <div className="qivryn-tool-status-icon h-4 w-4 flex-shrink-0 font-semibold">
        {icon}
      </div>
      {tool?.faviconUrl && (
        <img
          src={tool.faviconUrl}
          className="h-4 w-4 rounded-sm"
          alt=""
          aria-hidden="true"
        />
      )}
      <ToolCallStatusMessage tool={tool} toolCallState={toolCallState} />
    </>
  );

  return (
    <div className="qivryn-tool-display">
      <details
        className="qivryn-tool-disclosure"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="qivryn-tool-status-row">
          <span className="qivryn-tool-status-trigger">{statusContent}</span>
          <ChevronRightIcon
            className="qivryn-tool-disclosure-chevron"
            aria-hidden="true"
          />
        </summary>
        <div className="qivryn-tool-disclosure-body">{children}</div>
      </details>
      {!!toolCallState.output?.length && (
        <ToolTruncateHistoryIcon historyIndex={historyIndex} />
      )}
    </div>
  );
}
