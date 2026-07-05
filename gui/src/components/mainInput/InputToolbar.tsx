import { AtSymbolIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { InputModifiers } from "core";
import { modelSupportsImages } from "core/llm/autodetect";
import { memo, useContext, useRef } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import type { AgentAccessMode } from "../../redux/slices/uiSlice";
import { exitEdit } from "../../redux/thunks/edit";
import { ToolTip } from "../gui/Tooltip";
import { ModeSelect } from "../ModeSelect";
import { Button } from "../ui";
import { useFontSize } from "../ui/font";
import ContextStatus from "./ContextStatus";
import HoverItem from "./InputToolbar/HoverItem";
import { VoiceInputButton } from "./VoiceInputButton";

export interface ToolbarOptions {
  hideUseCodebase?: boolean;
  hideImageUpload?: boolean;
  hideAddContext?: boolean;
  enterText?: string;
  hideSelectModel?: boolean;
}

interface InputToolbarProps {
  onEnter?: (modifiers: InputModifiers) => void;
  onAddContextItem?: () => void;
  onClick?: () => void;
  onImageFileSelected?: (file: File) => void;
  hidden?: boolean;
  activeKey: string | null;
  toolbarOptions?: ToolbarOptions;
  disabled?: boolean;
  isMainInput?: boolean;
  agentAccessMode?: AgentAccessMode;
  onAgentAccessModeChange?: (mode: AgentAccessMode) => void;
  skillName?: string;
  onSkillChange?: (name: string | undefined) => void;
}

const TOOLBAR_INTERACTIVE_SELECTOR = [
  "button",
  "select",
  "input",
  "label",
  "[role='button']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='option']",
  "[aria-haspopup]",
  "[data-headlessui-state]",
  "[data-qivryn-interactive]",
  "ul",
].join(", ");

const iconButtonClass =
  "text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent p-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

function InputToolbar(props: InputToolbarProps) {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultModel = useAppSelector(selectSelectedChatModel);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const codeToEdit = useAppSelector((store) => store.editModeState.codeToEdit);
  const isEnterDisabled =
    props.disabled || (isInEdit && codeToEdit.length === 0);

  const supportsImages =
    defaultModel &&
    modelSupportsImages(
      defaultModel.provider,
      defaultModel.model,
      defaultModel.title,
      defaultModel.capabilities,
    );

  const smallFont = useFontSize(-2);
  const tinyFont = useFontSize(-3);

  return (
    <>
      <div
        onClick={(e) => {
          // Don't steal focus from child dropdowns.
          const target = e.target as HTMLElement;
          if (target.closest(TOOLBAR_INTERACTIVE_SELECTOR)) {
            return;
          }
          props.onClick?.();
        }}
        className={`find-widget-skip bg-vsc-input-background flex min-w-0 select-none flex-row flex-wrap items-center gap-1 pt-1 transition-opacity duration-150 ${props.hidden ? "pointer-events-none h-0 cursor-default opacity-0" : "pointer-events-auto mt-2 cursor-text opacity-100"}`}
        style={{
          fontSize: smallFont,
        }}
      >
        <div className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-1 overflow-visible min-[720px]:gap-1.5">
          {!isInEdit && (
            <ToolTip place="top" content="Select Mode">
              <HoverItem className="!p-0">
                <ModeSelect
                  skillName={props.skillName}
                  onSkillChange={props.onSkillChange}
                  agentAccessMode={props.agentAccessMode}
                  onAgentAccessModeChange={props.onAgentAccessModeChange}
                  includeAgentControls
                  includeModelControls={!props.toolbarOptions?.hideSelectModel}
                />
              </HoverItem>
            </ToolTip>
          )}
          <div className="xs:flex text-description -mb-1 hidden items-center gap-0.5 transition-colors duration-150">
            {!props.toolbarOptions?.hideImageUpload && supportsImages && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  aria-label="Attach image file"
                  accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
                  onChange={(e) => {
                    const files = e.target?.files ?? [];
                    for (const file of files) {
                      props.onImageFileSelected?.(file);
                    }
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                />

                <ToolTip place="top" content="Attach Image">
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label="Attach image"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <PhotoIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </ToolTip>
              </>
            )}
            {!props.toolbarOptions?.hideAddContext && (
              <ToolTip place="top" content="Attach Context">
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label="Attach context"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onAddContextItem?.();
                  }}
                >
                  <AtSymbolIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </ToolTip>
            )}
          </div>
        </div>

        <div
          className="text-description ml-auto flex flex-shrink-0 items-center gap-1 whitespace-nowrap"
          style={{
            fontSize: tinyFont,
          }}
        >
          {props.isMainInput && <VoiceInputButton />}
          {!isInEdit && <ContextStatus />}
          {isInEdit && (
            <HoverItem
              className="hidden hover:underline sm:flex"
              onClick={async () => {
                void dispatch(exitEdit({}));
                ideMessenger.post("focusEditor", undefined);
              }}
            >
              <span>
                <i>Esc</i> to exit Edit
              </span>
            </HoverItem>
          )}
          <ToolTip place="top" content="Send (⏎)">
            <Button
              variant={props.isMainInput ? "primary" : "secondary"}
              size="sm"
              data-testid="submit-input-button"
              aria-label={props.toolbarOptions?.enterText ?? "Enter"}
              onClick={async (e) => {
                if (props.onEnter) {
                  props.onEnter({
                    useCodebase: false,
                    noContext: true,
                  });
                }
              }}
              disabled={isEnterDisabled}
            >
              <span className="hidden md:inline">
                ⏎ {props.toolbarOptions?.enterText ?? "Enter"}
              </span>
              <span className="md:hidden">⏎</span>
            </Button>
          </ToolTip>
        </div>
      </div>
    </>
  );
}

function shallowToolbarOptionsEqual(a?: ToolbarOptions, b?: ToolbarOptions) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.hideAddContext === b.hideAddContext &&
    a.hideImageUpload === b.hideImageUpload &&
    a.hideUseCodebase === b.hideUseCodebase &&
    a.hideSelectModel === b.hideSelectModel &&
    a.enterText === b.enterText
  );
}

export default memo(
  InputToolbar,
  (prev, next) =>
    prev.hidden === next.hidden &&
    prev.disabled === next.disabled &&
    prev.isMainInput === next.isMainInput &&
    prev.activeKey === next.activeKey &&
    prev.agentAccessMode === next.agentAccessMode &&
    prev.onAgentAccessModeChange === next.onAgentAccessModeChange &&
    shallowToolbarOptionsEqual(prev.toolbarOptions, next.toolbarOptions),
);
