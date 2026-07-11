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
import {
  CheckIcon,
  ChevronDownIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setReasoningEffort } from "../../redux/slices/uiSlice";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "../ui/Listbox";
import { formatReasoningEffort } from "./reasoningEffortLabels";

export function ReasoningEffortSelect({
  hideLabel = false,
  optionsAnchor = "top start",
}: {
  hideLabel?: boolean;
  optionsAnchor?: "top start" | "bottom start";
} = {}) {
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

  const label = formatReasoningEffort(selected);

  return (
    <div className="qivryn-reasoning-select flex min-w-0 items-center gap-1.5">
      {!hideLabel && (
        <span className="text-description pointer-events-none select-none text-[11px] font-medium">
          Reasoning
        </span>
      )}

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
          className="qivryn-reasoning-trigger h-7 min-w-[88px] flex-none justify-between gap-1.5 px-2 py-0"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <SparklesIcon
              aria-hidden="true"
              className="h-3 w-3 flex-shrink-0 opacity-75"
            />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="h-2.5 w-2.5 flex-shrink-0 opacity-70"
          />
        </ListboxButton>

        <ListboxOptions
          anchor={optionsAnchor}
          fontSizeModifier={-3}
          className="qivryn-reasoning-menu min-w-[8rem]"
        >
          {levels.map((level) => (
            <ListboxOption
              key={level}
              value={level}
              fontSizeModifier={-3}
              className={`qivryn-reasoning-option ${
                level === selected
                  ? "bg-list-active text-list-active-foreground"
                  : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CheckIcon
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 flex-shrink-0 ${
                    level === selected ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span className="truncate">{formatReasoningEffort(level)}</span>
              </span>
            </ListboxOption>
          ))}
        </ListboxOptions>
      </Listbox>
    </div>
  );
}

export default ReasoningEffortSelect;
