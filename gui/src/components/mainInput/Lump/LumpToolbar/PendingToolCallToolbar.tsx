import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { selectPendingToolCalls } from "../../../../redux/selectors/selectToolCalls";
import { callToolById } from "../../../../redux/thunks/callToolById";
import { cancelToolCallThunk } from "../../../../redux/thunks/cancelToolCall";
import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import { Button } from "../../../ui";
import { useMainEditor } from "../../TipTapEditor";
import { AgentAccessModeSelect } from "./AgentAccessModeSelect";

export const generateToolCallButtonTestId = (
  action: "accept" | "reject",
  toolCallId: string,
) => {
  return `${action}-tool-call-button-${toolCallId}`;
};

export function PendingToolCallToolbar() {
  const dispatch = useAppDispatch();
  const jetbrains = isJetBrains();
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const editor = useMainEditor();

  if (pendingToolCalls.length === 0) {
    return null;
  }

  const handleAccept = (toolCallId: string) => {
    void dispatch(callToolById({ toolCallId }));
  };

  const handleReject = (toolCallId: string) => {
    // put cursor in editor after last rejection
    if (pendingToolCalls.length === 1) {
      editor.mainEditor?.commands.focus();
    }
    void dispatch(cancelToolCallThunk({ toolCallId }));
  };

  const handleAcceptAll = () => {
    pendingToolCalls.forEach((toolCall) => handleAccept(toolCall.toolCallId));
  };

  const handleRejectAll = () => {
    pendingToolCalls.forEach((toolCall) => handleReject(toolCall.toolCallId));
  };

  return (
    <div className="flex w-full min-w-0 flex-col pb-0.5">
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 py-0.5">
        <AgentAccessModeSelect />
        {pendingToolCalls.length > 1 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleRejectAll}>
              Reject all
            </Button>
            <Button variant="primary" size="sm" onClick={handleAcceptAll}>
              Accept all
            </Button>
          </div>
        )}
      </div>
      {pendingToolCalls.map((toolCall, index) => (
        <div
          key={toolCall.toolCallId}
          className="border-input bg-input flex min-w-0 items-center gap-2 rounded border px-1.5"
        >
          <span className="text-description flex-1 truncate text-xs italic">
            {toolCall.tool?.displayTitle ?? toolCall.toolCall.function.name}
          </span>

          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-description-muted my-1 font-medium"
              onClick={() => handleReject(toolCall.toolCallId)}
              data-testid={generateToolCallButtonTestId(
                "reject",
                toolCall.toolCallId,
              )}
            >
              {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
              {index === 0 && (
                <span className="text-2xs mr-1">
                  {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}⌫
                </span>
              )}
              <span>Reject</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              className="my-1 font-medium"
              onClick={() => handleAccept(toolCall.toolCallId)}
              data-testid={generateToolCallButtonTestId(
                "accept",
                toolCall.toolCallId,
              )}
            >
              {index === 0 && (
                <span className="text-2xs mr-1">{getMetaKeyLabel()}⏎</span>
              )}
              <span>Accept</span>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
