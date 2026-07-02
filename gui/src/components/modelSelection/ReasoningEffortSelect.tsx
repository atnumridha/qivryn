/**
 * ReasoningEffortSelect
 *
 * A stable dropdown (using Qivryn's own Listbox component) that lets the
 * user choose a reasoning effort level for the current model.
 *
 * Available levels come from:
 *   model.requestOptions.extraBodyProperties._reasoningLevels  (string[])
 *
 * Selected level is persisted in Redux uiSlice.reasoningEffortSettings keyed
 * by model title and injected into every request via streamNormalInput →
 * completionOptions.reasoningEffort.
 *
 * Renders nothing when the model has no reasoning levels.
 */
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setReasoningEffort } from "../../redux/slices/uiSlice";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/Listbox";

const EFFORT_LABELS: Record<string, string> = {
  none: "off",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  ultra: "ultra",
};

export function ReasoningEffortSelect() {
  const dispatch = useAppDispatch();
  const model = useAppSelector(selectSelectedChatModel);
  const effortSettings = useAppSelector(
    (state) => state.ui.reasoningEffortSettings,
  );

  if (!model) return null;

  const extra = model.requestOptions?.extraBodyProperties as
    | Record<string, any>
    | undefined;

  const levels: string[] = extra?._reasoningLevels ?? [];
  if (levels.length === 0) return null;

  const configDefault: string =
    (extra?.reasoning_effort as string | undefined) ??
    (levels.includes("medium") ? "medium" : (levels[0] ?? "medium"));

  const selected: string = effortSettings[model.title ?? ""] ?? configDefault;

  const label = EFFORT_LABELS[selected] ?? selected;

  return (
    <div className="flex items-center gap-0.5">
      <span
        className="text-description pointer-events-none select-none"
        style={{ fontSize: "0.65rem" }}
      >
        think:
      </span>

      <Listbox
        value={selected}
        onChange={(value: string) => {
          dispatch(
            setReasoningEffort({
              modelTitle: model.title ?? "",
              effort: value,
            }),
          );
        }}
      >
        <ListboxButton
          data-testid="reasoning-effort-select-button"
          fontSizeModifier={-4}
          className="flex items-center gap-0.5 border-0 bg-transparent px-0.5 py-0"
        >
          <span>{label}</span>
          <ChevronDownIcon className="h-2 w-2 opacity-70" />
        </ListboxButton>

        <ListboxOptions fontSizeModifier={-3} className="min-w-[5rem]">
          {levels.map((level) => (
            <ListboxOption
              key={level}
              value={level}
              fontSizeModifier={-3}
              className={
                level === selected
                  ? "bg-list-active text-list-active-foreground"
                  : ""
              }
            >
              <span className="flex items-center gap-1.5 py-0.5">
                <span className="w-4 text-center text-[10px] opacity-60">
                  {level === selected ? "✓" : ""}
                </span>
                <span>{EFFORT_LABELS[level] ?? level}</span>
              </span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}

export default ReasoningEffortSelect;
