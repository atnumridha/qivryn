import { useAppDispatch } from "../../../../redux/hooks";
import { cancelActiveApply } from "../../../../redux/thunks/cancelActiveApply";
import { getAltKeyLabel, getMetaKeyLabel } from "../../../../util";
import { GeneratingIndicator } from "./GeneratingIndicator";

export const IsApplyingToolbar = () => {
  const dispatch = useAppDispatch();
  const jetbrains = window.location.protocol === "jb-api:";

  return (
    <div className="flex w-full items-center justify-between">
      <GeneratingIndicator text="Applying" testId={"notch-applying-text"} />
      <div
        data-testid="notch-applying-cancel-button"
        className="text-description text-2xs cursor-pointer p-0.5 pr-1 hover:brightness-125"
        onClick={() => {
          void dispatch(cancelActiveApply());
        }}
      >
        {/* JetBrains overrides cmd+backspace, so we have to use another shortcut */}
        {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()} ⌫ Cancel
      </div>
    </div>
  );
};
