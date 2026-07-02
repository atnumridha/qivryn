import {
  CheckIcon,
  ChevronDownIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { AgentAccessMode } from "../../../../redux/slices/uiSlice";
import { setAgentAccessModeAndReleasePending } from "../../../../redux/thunks/setAgentAccessMode";
import { ToolTip } from "../../../gui/Tooltip";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../../../ui";

const ACCESS_MODES: Array<{
  value: AgentAccessMode;
  label: string;
  description: string;
}> = [
  {
    value: "ask",
    label: "Ask",
    description: "Use each tool's approval policy",
  },
  {
    value: "autonomous",
    label: "Autonomous",
    description: "Run safe actions and ask before risky commands",
  },
  {
    value: "fullAccess",
    label: "Full access",
    description: "Run tools without Qivryn approval",
  },
  {
    value: "readOnly",
    label: "Read only",
    description: "Hide and block mutating tools",
  },
];

export function AgentAccessModeSelect({
  value,
  onChange,
}: {
  value?: AgentAccessMode;
  onChange?: (mode: AgentAccessMode) => void;
} = {}) {
  const dispatch = useAppDispatch();
  const globalAccessMode = useAppSelector(
    (store) => store.ui.agentAccessMode ?? "autonomous",
  );
  const accessMode = value ?? globalAccessMode;
  const selected =
    ACCESS_MODES.find((candidate) => candidate.value === accessMode) ??
    ACCESS_MODES[1];

  const handleChange = (mode: AgentAccessMode) => {
    void dispatch(setAgentAccessModeAndReleasePending(mode));
    onChange?.(mode);
  };

  return (
    <Listbox value={accessMode} onChange={handleChange}>
      <div className="relative min-w-0">
        <ToolTip content={`${selected.label}: ${selected.description}`}>
          <ListboxButton
            aria-label="Agent access mode"
            className="text-description bg-lightgray/20 max-w-[132px] gap-1 rounded-full border-none px-1.5 py-0.5"
          >
            <ShieldCheckIcon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{selected.label}</span>
            <ChevronDownIcon className="h-2.5 w-2.5 flex-shrink-0" />
          </ListboxButton>
        </ToolTip>
        <ListboxOptions className="cursor-access-menu min-w-52">
          {ACCESS_MODES.map((candidate) => (
            <ListboxOption key={candidate.value} value={candidate.value}>
              <div className="min-w-0 pr-3">
                <div className="font-medium">{candidate.label}</div>
                <div className="text-description text-2xs whitespace-normal">
                  {candidate.description}
                </div>
              </div>
              <CheckIcon
                className={`h-3.5 w-3.5 flex-shrink-0 ${
                  candidate.value === accessMode ? "opacity-100" : "opacity-0"
                }`}
              />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
