import {
  ChevronDownIcon,
  Cog6ToothIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import {
  selectPendingToolCalls,
  selectToolCallsByStatus,
} from "../../../../redux/selectors/selectToolCalls";
import { setSelectedProfile } from "../../../../redux/slices/profilesSlice";
import { ToolTip } from "../../../gui/Tooltip";

import { useAuth } from "../../../../context/Auth";
import { CONFIG_ROUTES } from "../../../../util/navigation";
import { AssistantAndOrgListbox } from "../../../AssistantAndOrgListbox";
import { Popover, PopoverButton, PopoverPanel, Transition } from "../../../ui";

const toolbarIconButtonClass =
  "text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus inline-flex h-7 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent bg-transparent px-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1";

const toolbarTriggerClass =
  "text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 py-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1";

const headerTriggerClass =
  "text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1";

interface BlockSettingsTopToolbarProps {
  placement?: "header" | "composer";
}

export function BlockSettingsTopToolbar({
  placement = "header",
}: BlockSettingsTopToolbarProps) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { selectedProfile } = useAuth();

  const configError = useAppSelector((store) => store.config.configError);
  const ideMessenger = useContext(IdeMessengerContext);

  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const callingToolCalls = useAppSelector((state) =>
    selectToolCallsByStatus(state, "calling"),
  );
  const hasActiveContent =
    pendingToolCalls.length > 0 || callingToolCalls.length > 0;

  const shouldShowError = configError && configError?.length > 0;
  const panelPositionClass =
    placement === "composer"
      ? "bottom-full left-0 mb-2"
      : "right-0 top-full mt-1.5";
  const isHeaderPlacement = placement === "header";

  const handleRulesClick = () => {
    if (selectedProfile) {
      dispatch(setSelectedProfile(selectedProfile.id));
      ideMessenger.post("didChangeSelectedProfile", {
        id: selectedProfile.id,
      });
    }
    navigate(CONFIG_ROUTES.RULES);
  };

  const handleToolsClick = () => {
    if (selectedProfile) {
      dispatch(setSelectedProfile(selectedProfile.id));
      ideMessenger.post("didChangeSelectedProfile", {
        id: selectedProfile.id,
      });
    }
    navigate(CONFIG_ROUTES.TOOLS);
  };

  const handleModelsClick = () => {
    if (selectedProfile) {
      dispatch(setSelectedProfile(selectedProfile.id));
      ideMessenger.post("didChangeSelectedProfile", {
        id: selectedProfile.id,
      });
    }
    navigate(CONFIG_ROUTES.MODELS);
  };

  return (
    <Popover className="relative z-[130] flex-shrink-0" data-qivryn-interactive>
      <ToolTip place="top" content="Config, rules, tools, and models">
        <PopoverButton
          type="button"
          aria-label="Open config controls"
          className={
            isHeaderPlacement ? headerTriggerClass : toolbarTriggerClass
          }
        >
          <Cog6ToothIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {shouldShowError && (
            <span
              aria-hidden="true"
              className={
                isHeaderPlacement
                  ? "bg-warning absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
                  : "bg-warning h-1.5 w-1.5 rounded-full"
              }
            />
          )}
          {!isHeaderPlacement && (
            <>
              <span className="hidden sm:inline">Config</span>
              <ChevronDownIcon className="h-2.5 w-2.5" aria-hidden="true" />
            </>
          )}
        </PopoverButton>
      </ToolTip>

      <Transition>
        <PopoverPanel
          data-testid="qivryn-config-popover-panel"
          className={`bg-vsc-input-background border-command-border absolute z-[1000] max-h-[min(360px,calc(100vh-96px))] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-lg border p-2 shadow-2xl ${panelPositionClass}`}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-2xs text-description-muted font-medium uppercase tracking-wide">
                Config
              </div>
              <div className="text-description line-clamp-1 text-xs">
                Rules, tools, models, and profile
              </div>
            </div>

            <ToolTip place="top" content="Select Config">
              <div className="flex-shrink-0">
                <AssistantAndOrgListbox variant="lump" />
              </div>
            </ToolTip>
          </div>

          <div className="flex flex-col gap-1">
            {shouldShowError && (
              <button
                type="button"
                aria-label="View configuration errors"
                onClick={() => navigate(CONFIG_ROUTES.CONFIGS)}
                data-testid="block-settings-toolbar-icon-error"
                className={toolbarIconButtonClass}
              >
                <ExclamationTriangleIcon
                  className="text-warning h-3.5 w-3.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <span>View configuration errors</span>
              </button>
            )}

            {!hasActiveContent && (
              <>
                <button
                  type="button"
                  aria-label="Configure rules"
                  className={toolbarIconButtonClass}
                  onClick={handleRulesClick}
                >
                  <PencilIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Rules</span>
                </button>

                <button
                  type="button"
                  aria-label="Configure tools"
                  className={toolbarIconButtonClass}
                  onClick={handleToolsClick}
                >
                  <WrenchScrewdriverIcon
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  <span>Tools</span>
                </button>

                <button
                  type="button"
                  aria-label="Configure models"
                  className={toolbarIconButtonClass}
                  onClick={handleModelsClick}
                >
                  <CubeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Models</span>
                </button>
              </>
            )}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
}
