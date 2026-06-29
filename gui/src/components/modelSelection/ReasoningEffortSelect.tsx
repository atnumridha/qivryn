/**
 * ReasoningEffortSelect
 *
 * A compact dropdown that lets the user choose a reasoning effort level
 * (low / medium / high / xhigh / max / ultra) for the current model.
 *
 * The available levels are read from:
 *   model.requestOptions.extraBodyProperties._reasoningLevels   (array of strings)
 *   e.g. ["low", "medium", "high", "xhigh", "max", "ultra"]
 *
 * The selected level is persisted to Redux reasoningEffortSettings keyed by
 * model title, and injected into every request as `reasoningEffort` on
 * CompletionOptions → ChatGPTCodexApi / GitHubCopilotApi pick it up there.
 *
 * If the model has no _reasoningLevels it renders nothing.
 */
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setReasoningEffort } from "../../redux/slices/uiSlice";

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

  // Read available levels from model metadata
  const levels: string[] =
    (model.requestOptions?.extraBodyProperties as any)?._reasoningLevels ?? [];

  if (levels.length === 0) return null;

  // Determine current selection: UI override > config default > first level
  const configDefault =
    (model.requestOptions?.extraBodyProperties?.reasoning_effort as string) ??
    levels.find((l) => l === "medium") ??
    levels[0];

  const selected = effortSettings[model.title ?? ""] ?? configDefault;

  return (
    <div className="flex items-center gap-0.5">
      <span className="text-description" style={{ fontSize: "0.65rem" }}>
        think:
      </span>
      <select
        className="text-vsc-foreground hover:bg-vsc-input-background cursor-pointer rounded border-0 bg-transparent py-0 pl-0.5 pr-4 text-xs outline-none focus:outline-none"
        style={{
          fontSize: "0.65rem",
          appearance: "none",
          WebkitAppearance: "none",
        }}
        value={selected}
        title="Reasoning effort level"
        onChange={(e) => {
          dispatch(
            setReasoningEffort({
              modelTitle: model.title ?? "",
              effort: e.target.value,
            }),
          );
        }}
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {EFFORT_LABELS[level] ?? level}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ReasoningEffortSelect;
