import { ReactNode } from "react";
import { ToolTip } from "../../gui/Tooltip";

interface ToolbarButtonWithTooltipProps {
  onClick: () => void;
  children: ReactNode;
  tooltipContent: string;
  "data-testid"?: string;
}

export function ToolbarButtonWithTooltip({
  onClick,
  children,
  tooltipContent,
  "data-testid": testId,
}: ToolbarButtonWithTooltipProps) {
  return (
    <ToolTip place="top" content={tooltipContent}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={tooltipContent}
        title={tooltipContent}
        data-testid={testId}
        className="qivryn-code-toolbar-icon hover:description-muted/30 flex cursor-pointer select-none items-center justify-center rounded border-none bg-transparent hover:opacity-80"
      >
        {children}
      </button>
    </ToolTip>
  );
}
