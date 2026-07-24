import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquaresPlusIcon,
} from "@heroicons/react/24/outline";
import { MessageModes } from "core";
import { isRecommendedAgentModel } from "core/llm/toolSupport";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/Auth";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setMode } from "../../redux/slices/sessionSlice";
import {
  setReasoningEffort,
  setChatGPTBackendMode,
  type AgentAccessMode,
  type ChatGPTBackendMode,
} from "../../redux/slices/uiSlice";
import { setAgentAccessModeAndReleasePending } from "../../redux/thunks/setAgentAccessMode";
import { updateSelectedModelByRole } from "../../redux/thunks/updateSelectedModelByRole";
import { getFontSize, getMetaKeyLabel } from "../../util";
import { ROUTES } from "../../util/navigation";
import { ToolTip } from "../gui/Tooltip";
import { useMainEditor } from "../mainInput/TipTapEditor";
import { formatReasoningEffort } from "../modelSelection/reasoningEffortLabels";
import { SkillSummary, useSkillsCatalog } from "../skills/SkillSelect";
import { ModeIcon } from "./ModeIcon";

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

type AgentRuntimeMode = "local" | "docker" | "ssh";

const AGENT_RUNTIME_MODES: Array<{
  value: AgentRuntimeMode;
  label: string;
  description: string;
}> = [
  {
    value: "local",
    label: "Local",
    description: "Run in this workspace on your machine",
  },
  {
    value: "docker",
    label: "Docker",
    description: "Run in an isolated container runtime",
  },
  {
    value: "ssh",
    label: "Remote SSH",
    description: "Run on a configured remote host",
  },
];

const CHATGPT_BACKEND_MODES: Array<{
  value: ChatGPTBackendMode;
  label: string;
  description: string;
}> = [
  {
    value: "codex",
    label: "Codex",
    description: "Use the Codex responses backend",
  },
  {
    value: "chatgpt",
    label: "ChatGPT",
    description: "Use ChatGPT conversation with Qivryn agent rules",
  },
];

const MODEL_CACHE_KEY = "qivryn.models.catalog.v1";

interface CachedModelOption {
  value: string;
  title: string;
  apiKey?: string;
}

function readModelCache(): {
  options: CachedModelOption[];
  selected?: string;
} {
  try {
    const raw = window.localStorage.getItem(MODEL_CACHE_KEY);
    return raw ? JSON.parse(raw) : { options: [] };
  } catch {
    return { options: [] };
  }
}

function modelSelectTitle(model: any): string {
  if (model?.title) return model.title;
  if (model?.model !== undefined && model.model.trim() !== "") {
    if (model?.class_name) {
      return `${model.class_name} - ${model.model}`;
    }
    return model.model;
  }
  return model?.class_name ?? "Select model";
}

export function compactModelTriggerName(label: string): string {
  return label.replace(/^Codex:\s*/i, "").replace(/^GPT-/i, "");
}

const MENU_PANEL_BASE =
  "qivryn-mode-menu bg-vsc-input-background border-border no-scrollbar fixed flex min-w-0 origin-top-left flex-col overflow-y-auto rounded-lg border border-solid p-1";

const MENU_VIEWPORT_GAP = 8;
const MENU_TRIGGER_GAP = 6;
const RICH_MENU_WIDTH = 320;
const BASIC_MENU_WIDTH = 206;
const RICH_MENU_MAX_HEIGHT = 372;
const BASIC_MENU_MAX_HEIGHT = 360;
const DROPDOWN_LAYER = 10000;
const DROPDOWN_TOOLTIP_LAYER = DROPDOWN_LAYER + 10;
const NESTED_MENU_REVEAL_GAP = 4;

export function scrollTopToReveal({
  currentScrollTop,
  viewportTop,
  viewportBottom,
  targetTop,
  targetBottom,
  gap = NESTED_MENU_REVEAL_GAP,
}: {
  currentScrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  targetTop: number;
  targetBottom: number;
  gap?: number;
}): number {
  if (targetBottom + gap > viewportBottom) {
    return Math.max(0, currentScrollTop + targetBottom + gap - viewportBottom);
  }

  if (targetTop - gap < viewportTop) {
    return Math.max(0, currentScrollTop - (viewportTop - targetTop + gap));
  }

  return currentScrollTop;
}

const modeItemClass = (selected: boolean) =>
  `qivryn-mode-row group relative flex w-full cursor-pointer select-none flex-row items-center justify-between gap-1 rounded-lg border border-solid px-2 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus ${
    selected
      ? "border-border bg-list-active text-list-active-foreground"
      : "border-transparent bg-transparent text-foreground hover:bg-list-hover hover:text-foreground"
  }`;

const CONTROL_SECTION_CLASS =
  "border-input mt-1.5 space-y-1 border-0 border-t border-solid px-1 pt-1.5";

const controlButtonClass = (open: boolean) =>
  `qivryn-mode-control group flex w-full cursor-pointer items-center gap-2 rounded-lg border border-solid px-2 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus ${
    open
      ? "border-border bg-list-hover text-foreground"
      : "border-transparent bg-transparent text-description hover:bg-list-hover hover:text-foreground"
  }`;

const NESTED_PANEL_CLASS =
  "qivryn-mode-submenu border-input ml-4 mt-1 rounded-lg border-0 border-l border-solid bg-editor/40 p-1";

const nestedOptionClass = (selected: boolean, extra = "items-start") =>
  `qivryn-mode-subitem mb-0.5 flex w-full min-w-0 ${extra} gap-1.5 rounded-md border border-solid px-1.5 py-1 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus ${
    selected
      ? "border-border bg-list-active text-list-active-foreground"
      : "border-transparent bg-transparent text-description hover:bg-list-hover hover:text-foreground"
  }`;

export function ModeSelect({
  skillName,
  onSkillChange,
  agentAccessMode,
  onAgentAccessModeChange,
  agentRuntime,
  onAgentRuntimeChange,
  includeAgentControls = false,
  includeModelControls = false,
  modelOnly = false,
}: {
  skillName?: string;
  onSkillChange?: (name: string | undefined) => void;
  agentAccessMode?: AgentAccessMode;
  onAgentAccessModeChange?: (mode: AgentAccessMode) => void;
  agentRuntime?: AgentRuntimeMode;
  onAgentRuntimeChange?: (mode: AgentRuntimeMode) => void;
  includeAgentControls?: boolean;
  includeModelControls?: boolean;
  modelOnly?: boolean;
} = {}) {
  const menuId = useId();
  const skillsGroupId = useId();
  const runtimeGroupId = useId();
  const accessGroupId = useId();
  const modelGroupId = useId();
  const endpointGroupId = useId();
  const reasoningGroupId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reasoningPanelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { selectedProfile } = useAuth();
  const mode = useAppSelector((store) => store.session.mode);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const config = useAppSelector((store) => store.config.config);
  const isConfigLoading = useAppSelector((store) => store.config.loading);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const cachedModels = useRef(readModelCache());
  const [modelOptions, setModelOptions] = useState<CachedModelOption[]>(
    cachedModels.current.options,
  );
  const reasoningEffortSettings = useAppSelector(
    (store) => store.ui.reasoningEffortSettings,
  );
  const chatGPTBackendModeSettings = useAppSelector(
    (store) => store.ui.chatGPTBackendModeSettings,
  );
  const globalAccessMode = useAppSelector(
    (store) => store.ui.agentAccessMode ?? "autonomous",
  );
  const accessMode = agentAccessMode ?? globalAccessMode;
  const {
    skills,
    loading: skillsLoading,
    errors: skillErrors,
  } = useSkillsCatalog();
  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );
  const selectedSkill = sortedSkills.find((skill) => skill.name === skillName);
  const selectedAccessMode =
    ACCESS_MODES.find((candidate) => candidate.value === accessMode) ??
    ACCESS_MODES[1];
  const selectedRuntimeMode = agentRuntime
    ? AGENT_RUNTIME_MODES.find((candidate) => candidate.value === agentRuntime)
    : undefined;
  const role = isInEdit ? "edit" : "chat";
  const allModels =
    config.modelsByRole[role]?.length > 0
      ? config.modelsByRole[role]
      : config.modelsByRole.chat;
  const hasLiveModels = allModels?.length > 0;
  const roleSelectedModel =
    config.selectedModelByRole[role] ?? config.selectedModelByRole.chat;
  const displayedModelOptions =
    isConfigLoading || hasLiveModels ? modelOptions : [];
  const sortedModels = useMemo(() => {
    const options = displayedModelOptions.map((option) => ({
      title: option.title,
      value: option.value,
      missingApiKey: option.apiKey === "",
    }));

    return options.sort((a, b) => {
      if (a.missingApiKey !== b.missingApiKey) {
        return a.missingApiKey ? 1 : -1;
      }
      return a.title.localeCompare(b.title);
    });
  }, [displayedModelOptions]);
  const liveSelectedModelTitle =
    roleSelectedModel?.title ?? selectedModel?.title ?? "";
  const selectedModelTitle = sortedModels.some(
    (option) => option.value === liveSelectedModelTitle,
  )
    ? liveSelectedModelTitle
    : (cachedModels.current.selected ??
      sortedModels[0]?.value ??
      liveSelectedModelTitle);
  const selectedModelLabel =
    sortedModels.find((option) => option.value === selectedModelTitle)?.title ??
    (roleSelectedModel || selectedModel
      ? modelSelectTitle(roleSelectedModel ?? selectedModel)
      : undefined) ??
    "Select model";

  useEffect(() => {
    if (isConfigLoading || !allModels?.length) return;
    const nextOptions = allModels.map((model) => ({
      title: modelSelectTitle(model),
      value: model.title ?? modelSelectTitle(model),
      apiKey: model.apiKey === "" ? "" : undefined,
    }));
    const nextSelected =
      roleSelectedModel?.title ??
      selectedModel?.title ??
      (hasLiveModels || isConfigLoading
        ? cachedModels.current.selected
        : undefined);
    setModelOptions(nextOptions);
    cachedModels.current = {
      options: nextOptions,
      selected: nextSelected,
    };
    try {
      window.localStorage.setItem(
        MODEL_CACHE_KEY,
        JSON.stringify({
          options: nextOptions,
          selected: nextSelected,
        }),
      );
    } catch {
      // Hardened webviews may block localStorage; the live config still works.
    }
  }, [
    allModels,
    hasLiveModels,
    isConfigLoading,
    roleSelectedModel?.title,
    selectedModel?.title,
  ]);
  const selectedExtra = roleSelectedModel?.requestOptions
    ?.extraBodyProperties as Record<string, any> | undefined;
  const reasoningLevels: string[] = selectedExtra?._reasoningLevels ?? [];
  const defaultReasoningEffort =
    (selectedExtra?.reasoning_effort as string | undefined) ??
    (reasoningLevels.includes("medium")
      ? "medium"
      : (reasoningLevels[0] ?? "medium"));
  const selectedReasoningEffort =
    reasoningEffortSettings[selectedModelTitle] ?? defaultReasoningEffort;
  const selectedReasoningLabel = reasoningLevels.length
    ? formatReasoningEffort(selectedReasoningEffort)
    : undefined;
  const isChatGPTCodexModel =
    selectedModel?.provider === "chatgpt-codex" ||
    selectedModel?.underlyingProviderName === "chatgpt-codex";
  const defaultChatGPTBackendMode =
    ((roleSelectedModel ?? selectedModel) as any)?.chatgptBackendMode ??
    "codex";
  const selectedChatGPTBackendMode: ChatGPTBackendMode | undefined =
    isChatGPTCodexModel
      ? (chatGPTBackendModeSettings[selectedModelTitle] ??
        defaultChatGPTBackendMode)
      : undefined;
  const selectedChatGPTBackendLabel = selectedChatGPTBackendMode
    ? CHATGPT_BACKEND_MODES.find(
        (candidate) => candidate.value === selectedChatGPTBackendMode,
      )?.label
    : undefined;

  const isGoodAtAgentMode = useMemo(() => {
    if (!selectedModel) {
      return undefined;
    }
    return isRecommendedAgentModel(selectedModel.model);
  }, [selectedModel]);

  const { mainEditor } = useMainEditor();
  const metaKeyLabel = useMemo(() => {
    return getMetaKeyLabel();
  }, []);
  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button || typeof window === "undefined") {
      return;
    }

    const rect = button.getBoundingClientRect();
    const richMenu = includeAgentControls || includeModelControls || modelOnly;
    const preferredWidth = modelOnly
      ? 282
      : richMenu
        ? RICH_MENU_WIDTH
        : BASIC_MENU_WIDTH;
    const preferredMaxHeight = modelOnly
      ? 340
      : richMenu
        ? RICH_MENU_MAX_HEIGHT
        : BASIC_MENU_MAX_HEIGHT;
    const width = Math.max(
      168,
      Math.min(preferredWidth, window.innerWidth - MENU_VIEWPORT_GAP * 2),
    );
    const measuredPanelHeight = panelRef.current?.scrollHeight;
    const panelHeight = Math.min(
      measuredPanelHeight && measuredPanelHeight > 0
        ? measuredPanelHeight
        : preferredMaxHeight,
      preferredMaxHeight,
    );
    const spaceAbove = rect.top - MENU_VIEWPORT_GAP;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_VIEWPORT_GAP;
    const openAbove = spaceBelow < panelHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(
      160,
      Math.min(
        preferredMaxHeight,
        (openAbove ? spaceAbove : spaceBelow) - MENU_TRIGGER_GAP,
      ),
    );
    const left = Math.min(
      Math.max(MENU_VIEWPORT_GAP, rect.left),
      Math.max(
        MENU_VIEWPORT_GAP,
        window.innerWidth - width - MENU_VIEWPORT_GAP,
      ),
    );
    const top = openAbove
      ? Math.max(
          MENU_VIEWPORT_GAP,
          rect.top - availableHeight - MENU_TRIGGER_GAP,
        )
      : Math.min(
          window.innerHeight - availableHeight - MENU_VIEWPORT_GAP,
          rect.bottom + MENU_TRIGGER_GAP,
        );

    setMenuStyle({
      width,
      maxHeight: availableHeight,
      left,
      top,
      visibility: "visible",
    });
  }, [includeAgentControls, includeModelControls, modelOnly]);

  const closeModeDropdown = useCallback(() => {
    setIsOpen(false);
    setSkillsOpen(false);
    setRuntimeOpen(false);
    setAccessOpen(false);
    setModelOpen(false);
    setEndpointOpen(false);
    setReasoningOpen(false);
  }, []);

  const cycleMode = useCallback(() => {
    if (mode === "agent") {
      dispatch(setMode("chat"));
    } else if (mode === "chat") {
      dispatch(setMode("plan"));
    } else if (mode === "plan") {
      dispatch(setMode("debug"));
    } else {
      dispatch(setMode("agent"));
    }
    // Only focus main editor if another one doesn't already have focus
    if (!document.activeElement?.classList?.contains("ProseMirror")) {
      mainEditor?.commands.focus();
    }
  }, [mode, mainEditor]);

  const selectMode = useCallback(
    (newMode: MessageModes) => {
      closeModeDropdown();

      if (newMode === mode) {
        return;
      }

      dispatch(setMode(newMode));

      mainEditor?.commands.focus();
    },
    [closeModeDropdown, dispatch, mode, mainEditor],
  );

  const insertComposerTemplate = useCallback(
    (lines: string[]) => {
      closeModeDropdown();
      dispatch(setMode("agent"));
      if (mainEditor) {
        const currentText = mainEditor.getText().trim();
        if (!currentText) {
          mainEditor.commands.clearContent();
          mainEditor.commands.insertContent(lines.join("\n"));
        }
        mainEditor.commands.focus("end");
      }
    },
    [closeModeDropdown, dispatch, mainEditor],
  );

  const openBackgroundTasks = useCallback(() => {
    insertComposerTemplate(["Agent task:", ""]);
  }, [insertComposerTemplate]);

  const openParallelTasks = useCallback(() => {
    insertComposerTemplate([
      "Run in parallel:",
      "Review the current workspace changes",
      "Run the relevant validation checks",
      "Audit the UI for alignment, spacing, and overflow issues",
    ]);
  }, [insertComposerTemplate]);

  const openScheduledTask = useCallback(() => {
    closeModeDropdown();
    navigate(`${ROUTES.AGENTS}?scheduled=1`);
  }, [closeModeDropdown, navigate]);

  const focusAgentMode = useCallback(() => {
    closeModeDropdown();
    dispatch(setMode("agent"));
    mainEditor?.commands.focus();
  }, [closeModeDropdown, dispatch, mainEditor]);

  const selectSkill = useCallback(
    (skill: SkillSummary | undefined) => {
      onSkillChange?.(skill?.name);
      setSkillsOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, onSkillChange],
  );

  const selectAgentAccessMode = useCallback(
    (newAccessMode: AgentAccessMode) => {
      void dispatch(setAgentAccessModeAndReleasePending(newAccessMode));
      onAgentAccessModeChange?.(newAccessMode);
      setAccessOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, dispatch, onAgentAccessModeChange],
  );
  const selectAgentRuntime = useCallback(
    (runtime: AgentRuntimeMode) => {
      onAgentRuntimeChange?.(runtime);
      setRuntimeOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, onAgentRuntimeChange],
  );

  const selectModel = useCallback(
    (modelTitle: string) => {
      if (modelTitle === selectedModelTitle) {
        setModelOpen(false);
        closeModeDropdown();
        return;
      }
      void dispatch(
        updateSelectedModelByRole({
          selectedProfile,
          role,
          modelTitle,
        }),
      );
      setModelOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, dispatch, role, selectedModelTitle, selectedProfile],
  );

  const selectReasoningEffort = useCallback(
    (effort: string) => {
      dispatch(
        setReasoningEffort({
          modelTitle: selectedModelTitle,
          effort,
        }),
      );
      setReasoningOpen(false);
      setModelOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, dispatch, selectedModelTitle],
  );

  const selectChatGPTBackendMode = useCallback(
    (backendMode: ChatGPTBackendMode) => {
      dispatch(
        setChatGPTBackendMode({
          modelTitle: selectedModelTitle,
          mode: backendMode,
        }),
      );
      setEndpointOpen(false);
      setModelOpen(false);
      closeModeDropdown();
    },
    [closeModeDropdown, dispatch, selectedModelTitle],
  );

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const buttons = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      );
      if (buttons.length === 0) {
        return;
      }

      const currentIndex = buttons.findIndex(
        (button) => button === document.activeElement,
      );
      const focusButton = (index: number) => {
        event.preventDefault();
        buttons[(index + buttons.length) % buttons.length]?.focus();
      };

      if (event.key === "ArrowDown") {
        focusButton(currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        focusButton(currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1);
      } else if (event.key === "Home") {
        focusButton(0);
      } else if (event.key === "End") {
        focusButton(buttons.length - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModeDropdown();
        buttonRef.current?.focus();
      }
    },
    [closeModeDropdown],
  );

  const openOnly = useCallback(
    (
      menu:
        | "skills"
        | "runtime"
        | "access"
        | "model"
        | "endpoint"
        | "reasoning",
    ) => {
      setSkillsOpen((open) => (menu === "skills" ? !open : false));
      setRuntimeOpen((open) => (menu === "runtime" ? !open : false));
      setAccessOpen((open) => (menu === "access" ? !open : false));
      setModelOpen((open) =>
        menu === "model"
          ? !open
          : menu === "reasoning" || menu === "endpoint"
            ? true
            : false,
      );
      setEndpointOpen((open) => (menu === "endpoint" ? !open : false));
      setReasoningOpen((open) => (menu === "reasoning" ? !open : false));
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void cycleMode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cycleMode]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideInteraction = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        closeModeDropdown();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeModeDropdown();
      }
    };
    const handleReposition = () => updateMenuPosition();
    updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);

    document.addEventListener("pointerdown", handleOutsideInteraction, true);
    document.addEventListener("click", handleOutsideInteraction, true);
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
      document.removeEventListener("click", handleOutsideInteraction, true);
      document.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [closeModeDropdown, isOpen, updateMenuPosition]);

  useEffect(() => {
    if (isOpen) {
      updateMenuPosition();
      const frame = window.requestAnimationFrame(updateMenuPosition);
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    accessOpen,
    endpointOpen,
    isOpen,
    modelOpen,
    reasoningOpen,
    runtimeOpen,
    skillsOpen,
    sortedModels.length,
    sortedSkills.length,
    updateMenuPosition,
  ]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || !panel || typeof ResizeObserver === "undefined") {
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateMenuPosition);
    });
    observer.observe(panel);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen || !reasoningOpen) {
      return;
    }

    let revealFrame = 0;
    const positionFrame = window.requestAnimationFrame(() => {
      updateMenuPosition();
      revealFrame = window.requestAnimationFrame(() => {
        const panel = panelRef.current;
        const reasoningPanel = reasoningPanelRef.current;
        if (!panel || !reasoningPanel) {
          return;
        }

        const viewport = panel.getBoundingClientRect();
        const target = reasoningPanel.getBoundingClientRect();
        panel.scrollTop = scrollTopToReveal({
          currentScrollTop: panel.scrollTop,
          viewportTop: viewport.top,
          viewportBottom: viewport.bottom,
          targetTop: target.top,
          targetBottom: target.bottom,
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(positionFrame);
      window.cancelAnimationFrame(revealFrame);
    };
  }, [isOpen, reasoningOpen, updateMenuPosition]);

  const notGreatAtAgent = (mode: string) => (
    <>
      <ToolTip
        style={{
          zIndex: DROPDOWN_TOOLTIP_LAYER,
        }}
        className="flex items-center gap-1"
        content={`${mode} might not work well with this model.`}
      >
        <ExclamationTriangleIcon className="text-warning h-2.5 w-2.5" />
      </ToolTip>
    </>
  );
  const modeLabel =
    mode === "chat"
      ? "Ask"
      : mode === "agent"
        ? "Agent"
        : mode === "debug"
          ? "Debug"
          : "Plan";
  const triggerLabel = modelOnly
    ? compactModelTriggerName(selectedModelLabel)
    : modeLabel;

  return (
    <div
      ref={menuRef}
      className="qivryn-mode-select relative inline-flex"
      data-qivryn-interactive="true"
    >
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          data-testid={modelOnly ? "model-select-button" : "mode-select-button"}
          aria-label={modelOnly ? "Model dropdown" : "Agents mode dropdown"}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          className={`qivryn-select-trigger text-description hover:bg-list-hover hover:text-foreground focus-visible:ring-border-focus inline-flex h-6 items-center gap-1 rounded-md border border-solid px-2 py-0.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 ${
            modelOnly
              ? "qivryn-model-select-button max-w-[128px]"
              : "max-w-[112px]"
          } ${
            isOpen
              ? "border-border bg-list-hover text-foreground"
              : "bg-lightgray/20 border-transparent"
          }`}
          onClick={(event) => {
            event.preventDefault();
            if (isOpen) {
              closeModeDropdown();
            } else {
              setIsOpen(true);
            }
          }}
        >
          {!modelOnly && (
            <ModeIcon
              mode={mode}
              className="qivryn-mode-trigger-icon h-4 w-4"
            />
          )}
          {modelOnly ? (
            <span className="qivryn-mode-trigger-label flex min-w-0 items-center gap-1">
              <span className="qivryn-model-trigger-name min-w-0 truncate">
                {triggerLabel}
              </span>
              {selectedReasoningLabel && (
                <span className="qivryn-model-trigger-reasoning flex-shrink-0">
                  {selectedReasoningLabel}
                </span>
              )}
            </span>
          ) : (
            <span className="qivryn-mode-trigger-label block truncate">
              {triggerLabel}
            </span>
          )}
          <ChevronDownIcon
            className="qivryn-select-chevron h-2.5 w-2.5 flex-shrink-0"
            aria-hidden="true"
          />
        </button>
        {isOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              id={menuId}
              ref={panelRef}
              data-qivryn-interactive="true"
              role="menu"
              aria-label={
                modelOnly
                  ? "Model and reasoning controls"
                  : "Mode, skills, autonomy, model, and reasoning controls"
              }
              onKeyDown={handleMenuKeyDown}
              className={`${MENU_PANEL_BASE} ${modelOnly ? "qivryn-model-menu" : ""} ${
                includeAgentControls || includeModelControls || modelOnly
                  ? "max-h-[min(72vh,372px)] w-[min(320px,calc(100vw-16px))]"
                  : "max-h-[min(70vh,360px)] w-[min(206px,calc(100vw-16px))]"
              }`}
              style={{
                ...menuStyle,
                zIndex: DROPDOWN_LAYER,
              }}
            >
              {!modelOnly && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={modeItemClass(false)}
                    onClick={openBackgroundTasks}
                  >
                    <div className="flex min-w-0 flex-row items-center gap-1.5">
                      <ModeIcon mode="background" />
                      <span className="truncate">Agent tasks in composer</span>
                      <ToolTip
                        style={{ zIndex: DROPDOWN_TOOLTIP_LAYER }}
                        content="Start durable tasks without leaving this chat"
                      >
                        <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
                      </ToolTip>
                    </div>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className={modeItemClass(false)}
                    onClick={openParallelTasks}
                  >
                    <div className="flex min-w-0 flex-row items-center gap-1.5">
                      <SquaresPlusIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">Run in parallel</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className={modeItemClass(false)}
                    onClick={openScheduledTask}
                  >
                    <div className="flex min-w-0 flex-row items-center gap-1.5">
                      <CalendarDaysIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">Schedule</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === "agent"}
                    className={modeItemClass(mode === "agent")}
                    onClick={focusAgentMode}
                  >
                    <div className="flex flex-row items-center gap-1.5">
                      <ModeIcon mode="agent" />
                      <span>Agents</span>
                      <ToolTip
                        style={{ zIndex: DROPDOWN_TOOLTIP_LAYER }}
                        content="All tools available"
                      >
                        <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
                      </ToolTip>
                    </div>
                    {!isGoodAtAgentMode && notGreatAtAgent("Agents")}
                    <CheckIcon
                      className={`ml-auto h-3 w-3 ${mode === "agent" ? "" : "opacity-0"}`}
                    />
                  </button>

                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === "chat"}
                    className={modeItemClass(mode === "chat")}
                    onClick={() => selectMode("chat")}
                  >
                    <div className="flex flex-row items-center gap-1.5">
                      <ModeIcon mode="chat" />
                      <span className="">Ask</span>
                      <ToolTip
                        style={{
                          zIndex: DROPDOWN_TOOLTIP_LAYER,
                        }}
                        content="All tools disabled"
                      >
                        <InformationCircleIcon
                          data-tooltip-id="chat-tip"
                          className="h-2.5 w-2.5 flex-shrink-0"
                        />
                      </ToolTip>
                      <span
                        className={`text-description-muted text-[${getFontSize() - 3}px] mr-auto`}
                      >
                        {getMetaKeyLabel()}L
                      </span>
                    </div>
                    {mode === "chat" && (
                      <CheckIcon className="ml-auto h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === "plan"}
                    className={modeItemClass(mode === "plan")}
                    onClick={() => selectMode("plan")}
                  >
                    <div className="flex flex-row items-center gap-1.5">
                      <ModeIcon mode="plan" />
                      <span className="">Plan</span>
                      <ToolTip
                        style={{
                          zIndex: DROPDOWN_TOOLTIP_LAYER,
                        }}
                        content="Read-only/MCP tools available"
                      >
                        <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
                      </ToolTip>
                    </div>
                    {!isGoodAtAgentMode && notGreatAtAgent("Plan")}
                    <CheckIcon
                      className={`ml-auto h-3 w-3 ${mode === "plan" ? "" : "opacity-0"}`}
                    />
                  </button>

                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === "debug"}
                    className={modeItemClass(mode === "debug")}
                    onClick={() => selectMode("debug")}
                  >
                    <div className="flex flex-row items-center gap-1.5">
                      <ModeIcon mode="debug" />
                      <span>Debug</span>
                      <ToolTip
                        style={{ zIndex: DROPDOWN_TOOLTIP_LAYER }}
                        content="Reproduce, diagnose, fix, and validate"
                      >
                        <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
                      </ToolTip>
                    </div>
                    {!isGoodAtAgentMode && notGreatAtAgent("Debug")}
                    <CheckIcon
                      className={`ml-auto h-3 w-3 ${mode === "debug" ? "" : "opacity-0"}`}
                    />
                  </button>
                </>
              )}

              {!modelOnly && includeAgentControls && (
                <div
                  className={CONTROL_SECTION_CLASS}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="text-description-muted flex items-center gap-2 px-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]">
                    <span>Controls</span>
                    <span className="border-input h-px flex-1 border-0 border-t border-solid" />
                  </div>
                  <button
                    type="button"
                    aria-label="Skills dropdown"
                    aria-expanded={skillsOpen}
                    aria-controls={skillsGroupId}
                    className={controlButtonClass(skillsOpen)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openOnly("skills");
                    }}
                  >
                    <SparklesIcon className="h-3 w-3 flex-shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                        Skills {skillsLoading ? "…" : sortedSkills.length}
                      </span>
                      <span className="block truncate text-[11px] font-medium">
                        {selectedSkill?.name ?? "No skill"}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`h-3 w-3 flex-shrink-0 transition-transform ${
                        skillsOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {skillsOpen && (
                    <div
                      id={skillsGroupId}
                      role="group"
                      aria-label="Skill choices"
                      className={`${NESTED_PANEL_CLASS} no-scrollbar max-h-44 overflow-y-auto`}
                    >
                      <button
                        type="button"
                        className={`${nestedOptionClass(!selectedSkill, "items-center")} text-[11px]`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectSkill(undefined);
                          setSkillsOpen(false);
                        }}
                      >
                        <SparklesIcon className="h-3 w-3 flex-shrink-0 opacity-70" />
                        <span className="truncate">No skill</span>
                        <CheckIcon
                          className={`ml-auto h-3 w-3 ${!selectedSkill ? "" : "opacity-0"}`}
                        />
                      </button>
                      {sortedSkills.map((skill) => {
                        const isSelected = selectedSkill?.name === skill.name;
                        return (
                          <button
                            key={`${skill.name}:${skill.path}`}
                            type="button"
                            className={nestedOptionClass(isSelected)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              selectSkill(skill);
                              setSkillsOpen(false);
                            }}
                          >
                            <SparklesIcon className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium">
                                {skill.name}
                              </span>
                              <span className="text-description-muted block truncate text-[10px]">
                                {skill.provenance ?? "Workspace"} ·{" "}
                                {skill.description}
                              </span>
                            </span>
                            <CheckIcon
                              className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                                isSelected ? "" : "opacity-0"
                              }`}
                            />
                          </button>
                        );
                      })}
                      {!skillsLoading && sortedSkills.length === 0 && (
                        <div className="text-description-muted px-1.5 py-2 text-center text-[11px]">
                          {skillErrors[0] ?? "No skills were discovered"}
                        </div>
                      )}
                    </div>
                  )}
                  {agentRuntime && onAgentRuntimeChange && (
                    <>
                      <button
                        type="button"
                        aria-label="Runtime dropdown"
                        aria-expanded={runtimeOpen}
                        aria-controls={runtimeGroupId}
                        className={controlButtonClass(runtimeOpen)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openOnly("runtime");
                        }}
                      >
                        <CubeIcon className="h-3 w-3 flex-shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                            Runtime
                          </span>
                          <span className="block truncate text-[11px] font-medium">
                            {selectedRuntimeMode?.label ?? "Local"}
                          </span>
                        </span>
                        <ChevronDownIcon
                          className={`h-3 w-3 flex-shrink-0 transition-transform ${
                            runtimeOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {runtimeOpen && (
                        <div
                          id={runtimeGroupId}
                          role="group"
                          aria-label="Agent runtime"
                          className={`${NESTED_PANEL_CLASS} grid grid-cols-1 gap-1`}
                        >
                          {AGENT_RUNTIME_MODES.map((candidate) => {
                            const isSelected = candidate.value === agentRuntime;
                            return (
                              <button
                                key={candidate.value}
                                type="button"
                                className={nestedOptionClass(isSelected)}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  selectAgentRuntime(candidate.value);
                                  setRuntimeOpen(false);
                                }}
                              >
                                <CubeIcon className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-70" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[11px] font-medium">
                                    {candidate.label}
                                  </span>
                                  <span className="text-description-muted block truncate text-[10px]">
                                    {candidate.description}
                                  </span>
                                </span>
                                <CheckIcon
                                  className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                                    isSelected ? "" : "opacity-0"
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    aria-label="Autonomous dropdown"
                    aria-expanded={accessOpen}
                    aria-controls={accessGroupId}
                    className={controlButtonClass(accessOpen)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openOnly("access");
                    }}
                  >
                    <ShieldCheckIcon className="h-3 w-3 flex-shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1">
                      <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                        Autonomous
                      </span>
                      <span className="block truncate text-[11px] font-medium">
                        {selectedAccessMode.label}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`h-3 w-3 flex-shrink-0 transition-transform ${
                        accessOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {accessOpen && (
                    <div
                      id={accessGroupId}
                      role="group"
                      aria-label="Agent access mode"
                      className={`${NESTED_PANEL_CLASS} grid grid-cols-1 gap-1`}
                    >
                      {ACCESS_MODES.map((candidate) => {
                        const isSelected = candidate.value === accessMode;
                        return (
                          <button
                            key={candidate.value}
                            type="button"
                            className={nestedOptionClass(isSelected)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              selectAgentAccessMode(candidate.value);
                              setAccessOpen(false);
                            }}
                          >
                            <ShieldCheckIcon className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium">
                                {candidate.label}
                              </span>
                              <span className="text-description-muted block truncate text-[10px]">
                                {candidate.description}
                              </span>
                            </span>
                            <CheckIcon
                              className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                                isSelected ? "" : "opacity-0"
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {(includeModelControls || modelOnly) && (
                <div
                  className={modelOnly ? "space-y-1" : CONTROL_SECTION_CLASS}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {!modelOnly && (
                    <button
                      type="button"
                      aria-label="Model dropdown"
                      aria-expanded={modelOpen}
                      aria-controls={modelGroupId}
                      className={controlButtonClass(modelOpen)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openOnly("model");
                      }}
                    >
                      <CubeIcon className="h-3 w-3 flex-shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1">
                        <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                          Model
                        </span>
                        <span className="block truncate text-[11px] font-medium">
                          {selectedModelLabel}
                        </span>
                      </span>
                      <ChevronDownIcon
                        className={`h-3 w-3 flex-shrink-0 transition-transform ${
                          modelOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}

                  {(modelOpen || modelOnly) && (
                    <div
                      id={modelGroupId}
                      role="group"
                      aria-label="Model choices"
                      className={
                        modelOnly
                          ? "qivryn-mode-model-panel space-y-1"
                          : `${NESTED_PANEL_CLASS} space-y-1`
                      }
                    >
                      {modelOnly && (
                        <div className="qivryn-menu-section-label">
                          <CubeIcon
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                          />
                          <span>Model</span>
                        </div>
                      )}
                      <div className="no-scrollbar max-h-48 overflow-y-auto">
                        {isConfigLoading && sortedModels.length === 0 && (
                          <div className="text-description-muted px-1.5 py-2 text-center text-[11px]">
                            Loading models…
                          </div>
                        )}
                        {!isConfigLoading && sortedModels.length === 0 && (
                          <div className="text-description-muted px-1.5 py-2 text-center text-[11px]">
                            No models configured
                          </div>
                        )}
                        {sortedModels.map((option) => {
                          const isSelected =
                            option.value === selectedModelTitle;
                          return (
                            <button
                              key={`${option.value}:${option.title}`}
                              type="button"
                              aria-label={option.title}
                              title={option.title}
                              disabled={option.missingApiKey}
                              className={`${nestedOptionClass(isSelected, "items-center")} disabled:cursor-not-allowed disabled:opacity-50`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                selectModel(option.value);
                                setModelOpen(false);
                              }}
                            >
                              <CubeIcon
                                aria-hidden="true"
                                className="h-3.5 w-3.5 flex-shrink-0 opacity-70"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium">
                                  {option.title}
                                </span>
                                {option.missingApiKey && (
                                  <span className="text-description-muted block text-[10px]">
                                    Missing API key
                                  </span>
                                )}
                              </span>
                              <CheckIcon
                                className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                                  isSelected ? "" : "opacity-0"
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>

                      {selectedChatGPTBackendMode && (
                        <div className="border-input mt-1 border-t pt-1">
                          <button
                            type="button"
                            aria-label="Backend endpoint dropdown"
                            aria-expanded={endpointOpen}
                            aria-controls={endpointGroupId}
                            className={controlButtonClass(endpointOpen)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openOnly("endpoint");
                            }}
                          >
                            <CubeIcon
                              aria-hidden="true"
                              className="h-3.5 w-3.5 flex-shrink-0 opacity-70"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                                Endpoint
                              </span>
                              <span className="block truncate text-[11px] font-medium">
                                {selectedChatGPTBackendLabel}
                              </span>
                            </span>
                            <ChevronDownIcon
                              className={`h-3 w-3 flex-shrink-0 transition-transform ${
                                endpointOpen ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                          {endpointOpen && (
                            <div
                              id={endpointGroupId}
                              role="group"
                              aria-label="Backend endpoint choices"
                              className={`${NESTED_PANEL_CLASS} ml-3 grid grid-cols-1 gap-1`}
                            >
                              {CHATGPT_BACKEND_MODES.map((candidate) => {
                                const isSelected =
                                  candidate.value ===
                                  selectedChatGPTBackendMode;
                                return (
                                  <button
                                    key={candidate.value}
                                    type="button"
                                    aria-label={candidate.label}
                                    className={nestedOptionClass(isSelected)}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      selectChatGPTBackendMode(candidate.value);
                                      setEndpointOpen(false);
                                    }}
                                  >
                                    <CubeIcon
                                      aria-hidden="true"
                                      className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-70"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[11px] font-medium">
                                        {candidate.label}
                                      </span>
                                      <span className="text-description-muted block truncate text-[10px]">
                                        {candidate.description}
                                      </span>
                                    </span>
                                    <CheckIcon
                                      className={`mt-0.5 h-3 w-3 flex-shrink-0 ${
                                        isSelected ? "" : "opacity-0"
                                      }`}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {reasoningLevels.length > 0 && (
                        <div className="border-input mt-1 border-t pt-1">
                          <button
                            type="button"
                            aria-label="Reasoning dropdown"
                            aria-expanded={reasoningOpen}
                            aria-controls={reasoningGroupId}
                            className={controlButtonClass(reasoningOpen)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setReasoningOpen((open) => !open);
                            }}
                          >
                            <SparklesIcon
                              aria-hidden="true"
                              className="h-3.5 w-3.5 flex-shrink-0 opacity-70"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-description-muted block text-[10px] font-medium uppercase tracking-wide">
                                Reasoning
                              </span>
                              <span className="block truncate text-[11px] font-medium">
                                {formatReasoningEffort(selectedReasoningEffort)}
                              </span>
                            </span>
                            <ChevronDownIcon
                              className={`h-3 w-3 flex-shrink-0 transition-transform ${
                                reasoningOpen ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                          {reasoningOpen && (
                            <div
                              ref={reasoningPanelRef}
                              id={reasoningGroupId}
                              role="group"
                              aria-label="Reasoning choices"
                              className={`${NESTED_PANEL_CLASS} ml-3 grid grid-cols-1 gap-1`}
                            >
                              {reasoningLevels.map((level) => {
                                const isSelected =
                                  level === selectedReasoningEffort;
                                return (
                                  <button
                                    key={level}
                                    type="button"
                                    aria-label={formatReasoningEffort(level)}
                                    className={`${nestedOptionClass(isSelected, "items-center")} text-[11px]`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      selectReasoningEffort(level);
                                      setReasoningOpen(false);
                                    }}
                                  >
                                    <span className="truncate">
                                      {formatReasoningEffort(level)}
                                    </span>
                                    <CheckIcon
                                      className={`ml-auto h-3 w-3 flex-shrink-0 ${
                                        isSelected ? "" : "opacity-0"
                                      }`}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!modelOnly && (
                <div className="text-description-muted px-2 py-1">
                  {`${metaKeyLabel} . for next mode`}
                </div>
              )}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
