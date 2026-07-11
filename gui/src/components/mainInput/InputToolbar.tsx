import { InputModifiers } from "core";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpIcon,
  FolderOpenIcon,
  PaperClipIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { StopIcon } from "@heroicons/react/20/solid";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import type { AgentAccessMode } from "../../redux/slices/uiSlice";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { exitEdit } from "../../redux/thunks/edit";
import { getMetaKeyLabel } from "../../util";
import { ToolTip } from "../gui/Tooltip";
import { ModeSelect } from "../ModeSelect";
import { Button } from "../ui";
import { useFontSize } from "../ui/font";
import { getAttachmentMenuPosition } from "./attachmentMenuPosition";
import ContextStatus from "./ContextStatus";
import HoverItem from "./InputToolbar/HoverItem";

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
  onFilesSelected?: (files: File[]) => void;
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

const ATTACH_MENU_WIDTH = 192;
const ATTACH_MENU_ESTIMATED_HEIGHT = 76;
const ATTACH_MENU_LAYER = 10020;

function InputToolbar(props: InputToolbarProps) {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachControlRef = useRef<HTMLDivElement | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingAttachFocusRef = useRef<"first" | "last" | null>(null);
  const attachFocusTimerRef = useRef<number | null>(null);
  const attachMenuId = useId();
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachMenuStyle, setAttachMenuStyle] = useState<CSSProperties>({
    top: 8,
    left: 8,
    width: ATTACH_MENU_WIDTH,
    maxHeight: ATTACH_MENU_ESTIMATED_HEIGHT,
    visibility: "hidden",
  });
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const isStreaming = useAppSelector((store) => store.session.isStreaming);
  const codeToEdit = useAppSelector((store) => store.editModeState.codeToEdit);
  const showStop = Boolean(props.isMainInput && isStreaming);
  const isEnterDisabled =
    !showStop && (props.disabled || (isInEdit && codeToEdit.length === 0));

  const smallFont = useFontSize(-2);
  const tinyFont = useFontSize(-3);
  const sendLabel = props.isMainInput
    ? "Send"
    : (props.toolbarOptions?.enterText ?? "Enter");
  const sendShortcut = `${getMetaKeyLabel()} ↵`;
  const canAttachFile = !props.toolbarOptions?.hideImageUpload;
  const canAttachContext = !props.toolbarOptions?.hideAddContext;
  const hasAttachMenu = canAttachFile && canAttachContext;

  const updateAttachMenuPosition = useCallback(() => {
    const button = attachButtonRef.current;
    if (!button || typeof window === "undefined") {
      return;
    }

    const rect = button.getBoundingClientRect();
    const composerRect = button
      .closest<HTMLElement>(
        ".qivryn-main-editor-input, .qivryn-transcript-editor-input",
      )
      ?.getBoundingClientRect();
    const menu = attachMenuRef.current;
    const menuHeight = Math.max(
      menu?.scrollHeight ?? 0,
      menu?.offsetHeight ?? 0,
      ATTACH_MENU_ESTIMATED_HEIGHT,
    );
    const position = getAttachmentMenuPosition({
      anchor: {
        top: composerRect?.top ?? rect.top,
        right: rect.right,
        bottom: composerRect?.bottom ?? rect.bottom,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: ATTACH_MENU_WIDTH,
      menuHeight,
    });

    setAttachMenuStyle({
      top: position.top,
      left: position.left,
      width: position.width,
      maxHeight: position.maxHeight,
      visibility: "visible",
    });
  }, []);

  const closeAttachMenu = useCallback((restoreFocus = false) => {
    if (attachFocusTimerRef.current !== null) {
      window.clearTimeout(attachFocusTimerRef.current);
      attachFocusTimerRef.current = null;
    }
    pendingAttachFocusRef.current = null;
    setAttachMenuOpen(false);
    if (restoreFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => attachButtonRef.current?.focus());
    }
  }, []);

  const focusAttachMenuItem = useCallback((edge: "first" | "last") => {
    const items = Array.from(
      attachMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    items[edge === "first" ? 0 : items.length - 1]?.focus();
  }, []);

  const setAttachMenuElement = useCallback(
    (menu: HTMLDivElement | null) => {
      attachMenuRef.current = menu;
      const pendingFocus = pendingAttachFocusRef.current;
      if (!menu || !pendingFocus || typeof window === "undefined") {
        return;
      }

      attachFocusTimerRef.current = window.setTimeout(() => {
        if (pendingAttachFocusRef.current === pendingFocus) {
          focusAttachMenuItem(pendingFocus);
          pendingAttachFocusRef.current = null;
        }
        attachFocusTimerRef.current = null;
      }, 0);
    },
    [focusAttachMenuItem],
  );

  const openAttachMenu = useCallback((focus?: "first" | "last") => {
    setAttachMenuStyle({
      top: 8,
      left: 8,
      width: ATTACH_MENU_WIDTH,
      maxHeight: ATTACH_MENU_ESTIMATED_HEIGHT,
      visibility: "hidden",
    });
    pendingAttachFocusRef.current = focus ?? null;
    setAttachMenuOpen(true);
  }, []);

  const handleAttachMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        attachMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)',
        ) ?? [],
      );
      if (items.length === 0) {
        return;
      }

      const currentIndex = items.findIndex(
        (item) => item === document.activeElement,
      );
      const focusItem = (index: number) => {
        event.preventDefault();
        items[(index + items.length) % items.length]?.focus();
      };

      if (event.key === "ArrowDown") {
        focusItem(currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        focusItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
      } else if (event.key === "Home") {
        focusItem(0);
      } else if (event.key === "End") {
        focusItem(items.length - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeAttachMenu(true);
      }
    },
    [closeAttachMenu],
  );

  useEffect(() => {
    return () => {
      if (attachFocusTimerRef.current !== null) {
        window.clearTimeout(attachFocusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!attachMenuOpen || typeof window === "undefined") {
      return;
    }

    const isWithinAttachControl = (target: EventTarget | null) =>
      target instanceof Node &&
      (attachControlRef.current?.contains(target) ||
        attachMenuRef.current?.contains(target));
    const handleOutsideInteraction = (event: Event) => {
      if (!isWithinAttachControl(event.target)) {
        closeAttachMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeAttachMenu(true);
      }
    };
    const handleReposition = () => updateAttachMenuPosition();

    updateAttachMenuPosition();
    const frame = window.requestAnimationFrame(updateAttachMenuPosition);
    document.addEventListener("pointerdown", handleOutsideInteraction, true);
    document.addEventListener("focusin", handleOutsideInteraction, true);
    document.addEventListener("keydown", handleEscape, true);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener(
        "pointerdown",
        handleOutsideInteraction,
        true,
      );
      document.removeEventListener("focusin", handleOutsideInteraction, true);
      document.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [attachMenuOpen, closeAttachMenu, updateAttachMenuPosition]);

  useEffect(() => {
    const menu = attachMenuRef.current;
    if (!attachMenuOpen || !menu || typeof ResizeObserver === "undefined") {
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateAttachMenuPosition);
    });
    observer.observe(menu);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [attachMenuOpen, updateAttachMenuPosition]);

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
        className={`qivryn-input-toolbar find-widget-skip bg-vsc-input-background flex min-w-0 select-none flex-row ${
          props.isMainInput ? "flex-nowrap" : "flex-wrap"
        } items-center gap-1 pt-1 transition-opacity duration-150 ${props.hidden ? "pointer-events-none h-0 cursor-default opacity-0" : "pointer-events-auto mt-2 cursor-text opacity-100"}`}
        style={{
          fontSize: smallFont,
        }}
      >
        <div
          className={`qivryn-toolbar-primary-group flex min-w-0 flex-1 flex-row ${
            props.isMainInput ? "flex-nowrap" : "flex-wrap"
          } items-center gap-1 overflow-visible min-[720px]:gap-1.5`}
        >
          {!isInEdit && (
            <ToolTip place="top" content="Select Mode">
              <HoverItem className="!p-0">
                <ModeSelect
                  skillName={props.skillName}
                  onSkillChange={props.onSkillChange}
                  agentAccessMode={props.agentAccessMode}
                  onAgentAccessModeChange={props.onAgentAccessModeChange}
                  includeAgentControls
                />
              </HoverItem>
            </ToolTip>
          )}
          <div className="qivryn-toolbar-tools xs:flex text-description hidden items-center gap-0.5 transition-colors duration-150">
            {(canAttachFile || canAttachContext) && (
              <>
                {canAttachFile && (
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    aria-label="Attach file"
                    accept="image/*,.txt,.md,.markdown,.json,.jsonc,.yaml,.yml,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.css,.scss,.html,.xml,.sql,.py,.java,.kt,.kts,.go,.rs,.rb,.sh,.zsh,.bash,.log"
                    multiple
                    onChange={(e) => {
                      const files = e.target?.files ?? [];
                      props.onFilesSelected?.(Array.from(files));
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                  />
                )}

                <ToolTip place="top" content="Attach file, image, or context">
                  <div ref={attachControlRef} className="qivryn-attach-control">
                    <button
                      ref={attachButtonRef}
                      type="button"
                      className={`${iconButtonClass} qivryn-attach-button`}
                      aria-label="Attach file, image, or context"
                      aria-haspopup={hasAttachMenu ? "menu" : undefined}
                      aria-expanded={hasAttachMenu ? attachMenuOpen : undefined}
                      aria-controls={
                        hasAttachMenu && attachMenuOpen
                          ? attachMenuId
                          : undefined
                      }
                      onKeyDown={(event) => {
                        if (!hasAttachMenu) {
                          return;
                        }
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (attachMenuOpen) {
                            focusAttachMenuItem("first");
                          } else {
                            openAttachMenu("first");
                          }
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (attachMenuOpen) {
                            focusAttachMenuItem("last");
                          } else {
                            openAttachMenu("last");
                          }
                        }
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (canAttachFile && !canAttachContext) {
                          fileInputRef.current?.click();
                          return;
                        }
                        if (!canAttachFile && canAttachContext) {
                          props.onAddContextItem?.();
                          return;
                        }
                        if (attachMenuOpen) {
                          closeAttachMenu();
                        } else {
                          openAttachMenu();
                        }
                      }}
                    >
                      <PlusIcon aria-hidden="true" className="h-4 w-4" />
                    </button>
                    {hasAttachMenu &&
                      attachMenuOpen &&
                      typeof document !== "undefined" &&
                      createPortal(
                        <div
                          id={attachMenuId}
                          ref={setAttachMenuElement}
                          className="qivryn-attach-menu"
                          data-qivryn-interactive="true"
                          role="menu"
                          aria-label="Attachment options"
                          aria-orientation="vertical"
                          onKeyDown={handleAttachMenuKeyDown}
                          style={{
                            ...attachMenuStyle,
                            zIndex: ATTACH_MENU_LAYER,
                          }}
                        >
                          {canAttachFile && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                closeAttachMenu();
                                fileInputRef.current?.click();
                              }}
                            >
                              <PaperClipIcon
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              <span>File or Image</span>
                            </button>
                          )}
                          {canAttachContext && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                closeAttachMenu();
                                props.onAddContextItem?.();
                              }}
                            >
                              <FolderOpenIcon
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              <span>Workspace Context</span>
                            </button>
                          )}
                        </div>,
                        document.body,
                      )}
                  </div>
                </ToolTip>
              </>
            )}
          </div>
        </div>

        <div
          className="qivryn-toolbar-submit-cluster text-description ml-auto flex flex-shrink-0 items-center gap-1 whitespace-nowrap"
          style={{
            fontSize: tinyFont,
          }}
        >
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
          {props.isMainInput && (
            <span className="qivryn-submit-shortcut" aria-hidden="true">
              {sendShortcut}
            </span>
          )}
          {!isInEdit && !props.toolbarOptions?.hideSelectModel && (
            <div className="qivryn-toolbar-model-slot">
              <ToolTip place="top" content="Select model and reasoning">
                <HoverItem className="!p-0">
                  <ModeSelect modelOnly />
                </HoverItem>
              </ToolTip>
            </div>
          )}
          <ToolTip
            place="top"
            content={
              showStop
                ? "Stop"
                : props.isMainInput
                  ? `Send (${sendShortcut})`
                  : "Send (⏎)"
            }
          >
            <Button
              variant={props.isMainInput ? "primary" : "secondary"}
              size="sm"
              data-testid="submit-input-button"
              data-streaming={showStop ? "true" : "false"}
              aria-label={
                showStop
                  ? "Stop"
                  : props.isMainInput
                    ? `Send message (${sendShortcut})`
                    : sendLabel
              }
              onClick={async () => {
                if (showStop) {
                  void dispatch(cancelStream());
                  return;
                }
                if (props.onEnter) {
                  props.onEnter({
                    useCodebase: false,
                    noContext: true,
                  });
                }
              }}
              disabled={isEnterDisabled}
            >
              {showStop ? (
                <StopIcon
                  aria-hidden="true"
                  className="qivryn-stop-icon h-4 w-4"
                />
              ) : (
                <ArrowUpIcon
                  aria-hidden="true"
                  className="qivryn-send-icon h-4 w-4"
                />
              )}
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
