import { DocumentPlusIcon } from "@heroicons/react/24/outline";
import { ToolTip } from "../../gui/Tooltip";
import HoverItem from "../../mainInput/InputToolbar/HoverItem";

interface CreateFileButtonProps {
  onClick: () => void;
}

export function CreateFileButton({ onClick }: CreateFileButtonProps) {
  return (
    <ToolTip place="top" content="Create File with Code">
      <HoverItem className="!p-0">
        <button
          type="button"
          data-testid="codeblock-toolbar-create"
          aria-label="Create file with code"
          title="Create file with code"
          className="qivryn-code-toolbar-icon text-lightgray flex cursor-pointer items-center justify-center border-none bg-transparent outline-none hover:brightness-125"
          onClick={onClick}
        >
          <DocumentPlusIcon
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
          />
        </button>
      </HoverItem>
    </ToolTip>
  );
}
