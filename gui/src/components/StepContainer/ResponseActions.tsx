import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";
import { CopyIconButton } from "../gui/CopyIconButton";

export interface ResponseActionsProps {
  item: ChatHistoryItem;
}

export default function ResponseActions({ item }: ResponseActionsProps) {
  return (
    <div className="qivryn-response-actions text-description-muted flex cursor-default items-center justify-end bg-transparent pb-0 text-xs">
      <CopyIconButton
        tabIndex={-1}
        text={renderChatMessage(item.message)}
        clipboardIconClassName="h-4 w-4 text-description-muted"
        checkIconClassName="h-4 w-4 text-success"
      />
    </div>
  );
}
