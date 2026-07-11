import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { ToolTip } from "../../gui/Tooltip";
import { extractCommand } from "../utils/commandExtractor";

interface RunInTerminalButtonProps {
  command: string;
}

export function RunInTerminalButton({ command }: RunInTerminalButtonProps) {
  const ideMessenger = useContext(IdeMessengerContext);

  function runInTerminal() {
    // Extract just the command line
    const extractedCommand = extractCommand(command);
    void ideMessenger.post("runCommand", { command: extractedCommand });
  }

  return (
    <ToolTip place="top" content="Run in terminal">
      <button
        type="button"
        aria-label="Run in terminal"
        title="Run in terminal"
        className="qivryn-code-toolbar-icon text-lightgray flex cursor-pointer items-center justify-center border-none bg-transparent outline-none hover:brightness-125"
        onClick={runInTerminal}
      >
        <CommandLineIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </ToolTip>
  );
}
