import {
  RuleObject,
  RuleType,
  RuleTypeDescriptions,
  getRuleType,
  parseConfigYaml,
} from "@qivryn/config-yaml";
import {
  ArrowsPointingOutIcon,
  BookmarkIcon as BookmarkOutline,
  EyeIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import {
  BrowserSerializedQivrynConfig,
  RuleSource,
  RuleWithSource,
  SlashCommandDescWithSource,
} from "core";
import {
  DEFAULT_AGENT_SYSTEM_MESSAGE,
  DEFAULT_CHAT_SYSTEM_MESSAGE,
  DEFAULT_PLAN_SYSTEM_MESSAGE,
} from "core/llm/defaultSystemMessages";
import { getRuleDisplayName } from "core/llm/rules/rules-utils";
import { useContext, useMemo, useState } from "react";
import { DropdownButton } from "../../../components/DropdownButton";
import AddRuleDialog from "../../../components/dialogs/AddRuleDialog";
import ConfirmationDialog from "../../../components/dialogs/ConfirmationDialog";
import HeaderButtonWithToolTip from "../../../components/gui/HeaderButtonWithToolTip";
import Switch from "../../../components/gui/Switch";
import {
  useEditBlock,
  useOpenRule,
} from "../../../components/mainInput/Lump/useEditBlock";
import { useMainEditor } from "../../../components/mainInput/TipTapEditor";
import { Card, EmptyState } from "../../../components/ui";
import { useAuth } from "../../../context/Auth";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useBookmarkedSlashCommands } from "../../../hooks/useBookmarkedSlashCommands";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import {
  DEFAULT_RULE_SETTING,
  setDialogMessage,
  setShowDialog,
  toggleRuleSetting,
} from "../../../redux/slices/uiSlice";
import { fontSize } from "../../../util";
import { ConfigHeader } from "../components/ConfigHeader";

interface PromptCommandWithSlug extends SlashCommandDescWithSource {
  slug?: string;
}

interface PromptRowProps {
  prompt: PromptCommandWithSlug;
  isBookmarked: boolean;
  setIsBookmarked: (isBookmarked: boolean) => void;
  onEdit?: () => void;
}

/**
 * Displays a single prompt row with bookmark and edit controls
 */
function PromptRow({
  prompt,
  isBookmarked,
  setIsBookmarked,
  onEdit,
}: PromptRowProps) {
  const { mainEditor } = useMainEditor();

  const handlePromptClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    mainEditor?.commands.insertPrompt({
      title: prompt.name,
      description: prompt.description,
      content: prompt.prompt,
    });
  };

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBookmarked(!isBookmarked);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit();
    }
  };

  const canEdit = prompt.source !== "built-in";

  return (
    <div
      className="hover:bg-list-active hover:text-list-active-foreground flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:cursor-pointer"
      onClick={handlePromptClick}
      style={{
        fontSize: fontSize(-3),
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-vscForeground shrink-0 font-medium">
          {prompt.name}
        </span>
        <span className="line-clamp-2 text-[11px] text-gray-400">
          {prompt.description}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {canEdit && (
          <PencilIcon
            className={`h-3 w-3 cursor-pointer text-gray-400 hover:brightness-125`}
            onClick={canEdit ? handleEditClick : undefined}
            aria-disabled={!canEdit}
          />
        )}
        <div
          onClick={handleBookmarkClick}
          className="cursor-pointer pt-0.5 text-gray-400 hover:brightness-125"
        >
          {isBookmarked ? (
            <BookmarkSolid className="h-3 w-3" />
          ) : (
            <BookmarkOutline className="h-3 w-3" />
          )}
        </div>
      </div>
    </div>
  );
}

interface RuleCardProps {
  rule: RuleWithSource;
  variant?: "rule" | "system";
}

const systemMessageSources = new Set<RuleSource>([
  "default-chat",
  "default-agent",
  "default-plan",
  "model-options-chat",
  "model-options-agent",
  "model-options-plan",
]);

function getRuleTypeTone(ruleType: RuleType) {
  switch (ruleType) {
    case RuleType.Always:
      return "border-success text-success";
    case RuleType.AutoAttached:
      return "border-vsc-focusBorder text-vsc-foreground";
    case RuleType.AgentRequested:
      return "border-button text-vsc-foreground";
    case RuleType.Manual:
    default:
      return "border-description text-description";
  }
}

function formatPatternList(patterns: RuleObject["globs"]): string {
  if (!patterns) {
    return "";
  }
  return Array.isArray(patterns) ? patterns.join(", ") : patterns;
}

function getRuleTriggerText(rule: RuleWithSource, ruleType: RuleType): string {
  if (ruleType === RuleType.AutoAttached) {
    const globs = formatPatternList(rule.globs);
    const regex = formatPatternList(rule.regex);
    return [globs && `Files: ${globs}`, regex && `Regex: ${regex}`]
      .filter(Boolean)
      .join(" | ");
  }

  if (ruleType === RuleType.AgentRequested) {
    return rule.description
      ? `Agent uses when: ${rule.description}`
      : RuleTypeDescriptions[ruleType];
  }

  return RuleTypeDescriptions[ruleType];
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, variant = "rule" }) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const policy = useAppSelector((state) =>
    rule.name
      ? state.ui.ruleSettings[rule.name] || DEFAULT_RULE_SETTING
      : undefined,
  );

  const isDisabled = policy === "off";
  const openRule = useOpenRule();
  const handleTogglePolicy = () => {
    if (rule.name) {
      dispatch(toggleRuleSetting(rule.name));
    }
  };

  const title = useMemo(() => {
    return getRuleDisplayName(rule);
  }, [rule]);

  const ruleType = useMemo(() => getRuleType(rule), [rule]);
  const triggerText = getRuleTriggerText(rule, ruleType);
  const isSystemMessage =
    variant === "system" || systemMessageSources.has(rule.source);
  const sourceLabel = isSystemMessage
    ? "Built-in policy"
    : rule.sourceFile
      ? rule.sourceFile
      : rule.source;

  function onClickExpand() {
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <div className="max-h-4/5 p-4">
          <h3>{title}</h3>
          <pre className="max-w-full overflow-scroll">{rule.rule}</pre>
        </div>,
      ),
    );
  }

  const handleDelete = () => {
    if (!rule.sourceFile) {
      return;
    }

    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title="Delete Rule"
          text="Are you sure you want to delete this rule file?"
          confirmText="Delete"
          onConfirm={async () => {
            try {
              await ideMessenger.request("config/deleteRule", {
                filepath: rule.sourceFile!,
              });
            } catch (error) {
              console.error("Failed to delete rule file:", error);
            }
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  const canDeleteRule =
    rule.sourceFile && !systemMessageSources.has(rule.source);

  const smallFont = fontSize(-2);
  const tinyFont = fontSize(-3);
  return (
    <div
      className={`border-border bg-input flex flex-col rounded-md border px-3 py-2 transition-colors ${isDisabled ? "opacity-50" : ""}`}
    >
      <div className="flex flex-col">
        <div className="flex flex-row justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className={`line-clamp-2 font-medium ${isDisabled ? "text-gray-400" : "text-vsc-foreground"}`}
              style={{
                fontSize: smallFont,
              }}
            >
              {title}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] ${getRuleTypeTone(ruleType)}`}
              >
                {ruleType}
              </span>
              <span className="text-description-muted max-w-full truncate text-[10px]">
                {sourceLabel}
              </span>
            </div>
          </div>
          <div className="flex flex-row items-center gap-2">
            {!isSystemMessage && rule.name && policy && (
              <div className="flex cursor-pointer flex-row items-center justify-end gap-1 px-2 py-0.5">
                <Switch
                  isToggled={policy === "on"}
                  onToggle={() => handleTogglePolicy()}
                  size={10}
                  text=""
                />
              </div>
            )}
            <div className="flex flex-row items-start gap-1">
              <HeaderButtonWithToolTip onClick={onClickExpand} text="Expand">
                <ArrowsPointingOutIcon className="h-3 w-3 text-gray-400" />
              </HeaderButtonWithToolTip>{" "}
              {isSystemMessage ? (
                <HeaderButtonWithToolTip
                  onClick={() => openRule(rule)}
                  text="View"
                >
                  <EyeIcon className="h-3 w-3 text-gray-400" />
                </HeaderButtonWithToolTip>
              ) : (
                <HeaderButtonWithToolTip
                  onClick={() => openRule(rule)}
                  text="Edit"
                >
                  <PencilIcon className="h-3 w-3 text-gray-400" />
                </HeaderButtonWithToolTip>
              )}
              {canDeleteRule && (
                <HeaderButtonWithToolTip onClick={handleDelete} text="Delete">
                  <TrashIcon className="h-3 w-3 text-gray-400" />
                </HeaderButtonWithToolTip>
              )}
            </div>
          </div>
        </div>

        <span
          style={{
            fontSize: tinyFont,
          }}
          className={`mt-2 line-clamp-3 whitespace-pre-wrap ${isDisabled ? "text-gray-500" : "text-gray-400"}`}
        >
          {rule.rule}
        </span>
        {triggerText ? (
          <div
            style={{
              fontSize: tinyFont,
            }}
            className="mt-2 flex flex-col gap-1"
          >
            <span className={isDisabled ? "text-gray-500" : "text-gray-400"}>
              {triggerText}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Section that displays all available prompts with bookmarking functionality
 */
function PromptsSubSection() {
  const { selectedProfile } = useAuth();
  const { isCommandBookmarked, toggleBookmark } = useBookmarkedSlashCommands();
  const ideMessenger = useContext(IdeMessengerContext);

  const slashCommands = useAppSelector(
    (state) => state.config.config.slashCommands ?? [],
  );

  const editBlock = useEditBlock();

  const handleEdit = (prompt: PromptCommandWithSlug) => {
    editBlock(prompt.slug, prompt.sourceFile);
  };

  const handleAddPrompt = () => {
    void ideMessenger.request("config/addLocalWorkspaceBlock", {
      blockType: "prompts",
    });
  };

  const sortedCommands = useMemo(() => {
    const promptsWithSlug: PromptCommandWithSlug[] =
      structuredClone(slashCommands);
    // get the slugs from rawYaml
    if (selectedProfile?.rawYaml) {
      const parsed = parseConfigYaml(selectedProfile.rawYaml);
      const parsedPrompts = parsed.prompts ?? [];

      let index = 0;
      for (const commandWithSlug of promptsWithSlug) {
        // skip for local prompt files
        if (commandWithSlug.sourceFile) continue;

        const yamlPrompt = parsedPrompts[index];
        if (yamlPrompt) {
          if ("uses" in yamlPrompt) {
            commandWithSlug.slug = yamlPrompt.uses;
          } else {
            commandWithSlug.slug = `${selectedProfile?.fullSlug.ownerSlug}/${selectedProfile?.fullSlug.packageSlug}`;
          }
        }
        index = index + 1;
      }
    }
    return promptsWithSlug.sort((a, b) => {
      const aBookmarked = isCommandBookmarked(a.name);
      const bBookmarked = isCommandBookmarked(b.name);
      if (aBookmarked && !bBookmarked) return -1;
      if (!aBookmarked && bBookmarked) return 1;
      return 0;
    });
  }, [slashCommands, isCommandBookmarked, selectedProfile]);

  return (
    <div>
      <ConfigHeader
        title="Prompts"
        variant="sm"
        onAddClick={handleAddPrompt}
        addButtonTooltip="Add prompt"
      />

      {sortedCommands.length > 0 ? (
        <Card>
          <div>
            {sortedCommands.map((prompt) => (
              <PromptRow
                key={prompt.name}
                prompt={prompt}
                isBookmarked={isCommandBookmarked(prompt.name)}
                setIsBookmarked={() => toggleBookmark(prompt)}
                onEdit={() => handleEdit(prompt)}
              />
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState message="No prompts configured. Click the + button to add your first prompt." />
        </Card>
      )}
    </div>
  );
}

/**
 * Helper function to add the appropriate default system message based on mode
 */
function addDefaultSystemMessage(
  rules: RuleWithSource[],
  mode: string,
  config: BrowserSerializedQivrynConfig,
) {
  const modeConfig = {
    chat: {
      customMessage: config.selectedModelByRole.chat?.baseChatSystemMessage,
      defaultMessage: DEFAULT_CHAT_SYSTEM_MESSAGE,
      customSource: "model-options-chat" as RuleSource,
      defaultSource: "default-chat" as RuleSource,
    },
    agent: {
      customMessage: config.selectedModelByRole.chat?.baseAgentSystemMessage,
      defaultMessage: DEFAULT_AGENT_SYSTEM_MESSAGE,
      customSource: "model-options-agent" as RuleSource,
      defaultSource: "default-agent" as RuleSource,
    },
    plan: {
      customMessage: config.selectedModelByRole.chat?.basePlanSystemMessage,
      defaultMessage: DEFAULT_PLAN_SYSTEM_MESSAGE,
      customSource: "model-options-plan" as RuleSource,
      defaultSource: "default-plan" as RuleSource,
    },
  };

  const currentMode = modeConfig[mode as keyof typeof modeConfig];
  if (currentMode) {
    const message = currentMode.customMessage || currentMode.defaultMessage;
    const source = currentMode.customMessage
      ? currentMode.customSource
      : currentMode.defaultSource;

    rules.unshift({
      rule: message,
      source,
    });
  }
}

// Define dropdown options for global rules
const globalRulesOptions = [
  { value: "workspace", label: "Current workspace" },
  { value: "global", label: "Global" },
];

function RulesSubSection() {
  const { selectedProfile } = useAuth();
  const config = useAppSelector((store) => store.config.config);
  const mode = useAppSelector((store) => store.session.mode);
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const [globalRulesMode, setGlobalRulesMode] = useState<string>("workspace");
  const configLoading = useAppSelector((store) => store.config.loading);

  const handleAddRule = (mode?: string) => {
    const currentMode = mode || globalRulesMode;
    dispatch(setShowDialog(true));
    dispatch(
      setDialogMessage(
        <AddRuleDialog
          mode={currentMode === "global" ? "global" : "workspace"}
        />,
      ),
    );
  };

  const handleOptionClick = (value: string) => {
    setGlobalRulesMode(value);
    handleAddRule(value);
  };

  const sortedRules: RuleWithSource[] = useMemo(() => {
    const rules = [...config.rules.map((rule) => ({ ...rule }))];

    // Use profile rawYaml to infer slugs
    if (selectedProfile?.rawYaml) {
      try {
        const parsed = parseConfigYaml(selectedProfile.rawYaml);
        const parsedRules = parsed?.rules ?? [];
        let index = 0;
        for (const rule of rules) {
          if (rule.source === "rules-block") {
            let slug: string | undefined = undefined;
            const yamlRule = parsedRules[index];
            if (yamlRule) {
              if (typeof yamlRule !== "string" && "uses" in yamlRule) {
                slug = yamlRule.uses;
              } else {
                slug = `${selectedProfile?.fullSlug.ownerSlug}/${selectedProfile?.fullSlug.packageSlug}`;
              }
            }
            if (slug) {
              rule.slug = slug;
            }

            index++;
          }
        }
      } catch (e) {
        console.error(
          "Rules notch section: failed to parse selected profile",
          e,
        );
      }
    }

    addDefaultSystemMessage(rules, mode, config);

    return rules;
  }, [config, selectedProfile, mode]);

  const systemRules = useMemo(
    () => sortedRules.filter((rule) => systemMessageSources.has(rule.source)),
    [sortedRules],
  );
  const configuredRules = useMemo(
    () => sortedRules.filter((rule) => !systemMessageSources.has(rule.source)),
    [sortedRules],
  );

  const typeSummary = useMemo(() => {
    const counts = new Map<RuleType, number>();
    for (const rule of configuredRules) {
      const ruleType = getRuleType(rule);
      counts.set(ruleType, (counts.get(ruleType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([ruleType, count]) => `${ruleType}: ${count}`)
      .join(" | ");
  }, [configuredRules]);

  return (
    <div>
      <DropdownButton
        title="Rules"
        variant="sm"
        options={globalRulesOptions}
        onOptionClick={handleOptionClick}
        addButtonTooltip="Add rules"
      />

      <div className="flex flex-col gap-4">
        {systemRules.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-medium">Built-in behavior</span>
              <span className="text-description-muted text-2xs">
                Current {mode} mode policy
              </span>
            </div>
            <Card>
              <div className="flex flex-col gap-3">
                {systemRules.map((rule, index) => (
                  <RuleCard
                    key={
                      rule.sourceFile ?? rule.name ?? `${rule.source}-${index}`
                    }
                    rule={rule}
                    variant="system"
                  />
                ))}
              </div>
            </Card>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-xs font-medium">Configured rules</span>
            {typeSummary && (
              <span className="text-description-muted text-2xs truncate">
                {typeSummary}
              </span>
            )}
          </div>
          <Card>
            {configuredRules.length > 0 ? (
              <div className="flex flex-col gap-3">
                {configuredRules.map((rule, index) => (
                  <RuleCard
                    key={
                      rule.sourceFile ?? rule.name ?? `${rule.source}-${index}`
                    }
                    rule={rule}
                  />
                ))}
                {configLoading && (
                  <div className="px-2 py-1.5 text-xs opacity-65">
                    Reloading rules from your config...
                  </div>
                )}
              </div>
            ) : (
              <EmptyState message="No rules configured. Click the + button to add your first rule." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function RulesSection() {
  return (
    <>
      <ConfigHeader title="Rules" />

      <div className="space-y-6">
        <RulesSubSection />
        <PromptsSubSection />
      </div>
    </>
  );
}
