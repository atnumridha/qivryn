import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { ToolCallState } from "core";
import { getGroupActionVerb } from "./utils";

interface GroupedToolCallHeaderProps {
  toolCallStates: ToolCallState[];
  activeCalls: ToolCallState[];
  open: boolean;
  onToggle: () => void;
}

export function GroupedToolCallHeader({
  toolCallStates,
  activeCalls,
  open,
  onToggle,
}: GroupedToolCallHeaderProps) {
  return (
    <div className="qivryn-tool-group-header">
      <button
        type="button"
        className="text-description flex cursor-pointer items-center gap-1.5 transition-colors duration-200 ease-in-out hover:brightness-125"
        data-testid="performing-actions"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${activeCalls.length} ${activeCalls.length === 1 ? "action" : "actions"}`}
        onClick={onToggle}
      >
        <span
          className={`qivryn-tool-group-chevron ${open ? "is-open" : ""}`}
          aria-hidden="true"
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
        {getGroupActionVerb(toolCallStates)} {activeCalls.length}{" "}
        {activeCalls.length === 1 ? "action" : "actions"}
      </button>
    </div>
  );
}
