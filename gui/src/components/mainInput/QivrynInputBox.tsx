import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { Editor, JSONContent } from "@tiptap/react";
import {
  ContextItemWithId,
  InputModifiers,
  RuleMetadata,
  SlashCommandSource,
} from "core";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { defaultBorderRadius, vscBackground } from "..";
import { useAppSelector } from "../../redux/hooks";
import { selectSlashCommandComboBoxInputs } from "../../redux/selectors";
import { ContextItemsPeek } from "./belowMainInput/ContextItemsPeek";
import { RulesPeek } from "./belowMainInput/RulesPeek";
import { GradientBorder } from "./GradientBorder";
import { ToolbarOptions } from "./InputToolbar";
import { Lump } from "./Lump";
import { TipTapEditor } from "./TipTapEditor";

interface QivrynInputBoxProps {
  isLastUserInput: boolean;
  isMainInput?: boolean;
  onEnter: (
    editorState: JSONContent,
    modifiers: InputModifiers,
    editor: Editor,
  ) => void;
  editorState?: JSONContent;
  contextItems?: ContextItemWithId[];
  appliedRules?: RuleMetadata[];
  hidden?: boolean;
  inputId: string; // used to keep track of things per input in redux
  showMessageActions?: boolean;
}

const EDIT_DISALLOWED_CONTEXT_PROVIDERS = [
  "codebase",
  "tree",
  "open",
  "web",
  "diff",
  "folder",
  "search",
  "debugger",
  "repo-map",
];

const EDIT_ALLOWED_SLASH_COMMAND_SOURCES: SlashCommandSource[] = [
  "yaml-prompt-block",
  "mcp-prompt",
  "prompt-file-v1",
  "prompt-file-v2",
  "invokable-rule",
  "json-custom-command",
];

function QivrynInputBox(props: QivrynInputBoxProps) {
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const editorRef = useRef<Editor | null>(null);
  const availableSlashCommands = useAppSelector(
    selectSlashCommandComboBoxInputs,
  );
  const availableContextProviders = useAppSelector(
    (state) => state.config.config.contextProviders,
  );
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const editModeState = useAppSelector((state) => state.editModeState);
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);

  useEffect(() => {
    setIsTranscriptEditing(false);
  }, [props.inputId]);

  const filteredSlashCommands = useMemo(() => {
    if (isInEdit) {
      return availableSlashCommands.filter((cmd) =>
        cmd.slashCommandSource
          ? EDIT_ALLOWED_SLASH_COMMAND_SOURCES.includes(cmd.slashCommandSource)
          : false,
      );
    }
    return availableSlashCommands;
  }, [isInEdit, availableSlashCommands]);

  const filteredContextProviders = useMemo(() => {
    if (isInEdit) {
      return (
        availableContextProviders?.filter(
          (provider) =>
            !EDIT_DISALLOWED_CONTEXT_PROVIDERS.includes(provider.title),
        ) ?? []
      );
    }

    return availableContextProviders ?? [];
  }, [availableContextProviders, isInEdit]);

  const historyKey = isInEdit ? "edit" : "chat";
  const placeholder = isInEdit ? "Edit selected code" : undefined;
  const { appliedRules = [], contextItems = [] } = props;
  const isMainInput = props.isMainInput ?? false;

  const toolbarOptions: ToolbarOptions = useMemo(() => {
    if (isInEdit) {
      return {
        hideAddContext: false,
        hideImageUpload: false,
        hideUseCodebase: true,
        hideSelectModel: false,
        enterText:
          editModeState.applyState.status === "done" ? "Retry" : "Edit",
      } as ToolbarOptions;
    }
    if (!isMainInput) {
      return {
        enterText: "Restart",
      } as ToolbarOptions;
    }
    // Stable empty object to avoid re-renders from identity changes
    return {} as ToolbarOptions;
  }, [isInEdit, isMainInput, editModeState.applyState.status]);

  const handleEditorReady = useCallback(
    (editor: Editor | null) => {
      if (!isMainInput) {
        editorRef.current = editor;
      }
    },
    [isMainInput],
  );

  const handleEditMessage = useCallback(() => {
    setIsTranscriptEditing(true);
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) {
      return;
    }
    requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
  }, []);

  const handleActionMouseDown = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const showTranscriptActions =
    !isMainInput && props.showMessageActions && !props.hidden;

  const editor = (
    <TipTapEditor
      editorState={props.editorState}
      onEnter={props.onEnter}
      placeholder={placeholder}
      isMainInput={isMainInput}
      availableContextProviders={filteredContextProviders}
      availableSlashCommands={filteredSlashCommands}
      historyKey={historyKey}
      toolbarOptions={toolbarOptions}
      inputId={props.inputId}
      onEditorReady={handleEditorReady}
      readOnly={!isMainInput && !isTranscriptEditing}
    />
  );

  return (
    <div
      className={`min-w-0 max-w-full ${isMainInput ? "qivryn-main-input-box overflow-x-hidden" : "qivryn-transcript-input-box overflow-x-hidden"} ${props.hidden ? "hidden" : ""}`}
      data-testid={`qivryn-input-box-${props.inputId}`}
    >
      <div
        className={`relative flex min-w-0 max-w-full flex-col ${isMainInput ? "qivryn-main-input-shell px-2" : "qivryn-transcript-input-shell"}`}
      >
        {isMainInput && <Lump />}
        {isMainInput ? (
          <GradientBorder
            className="qivryn-main-input-frame"
            loading={isStreaming && (props.isLastUserInput || isInEdit) ? 1 : 0}
            borderColor={
              isStreaming && (props.isLastUserInput || isInEdit)
                ? undefined
                : vscBackground
            }
            borderRadius={defaultBorderRadius}
          >
            {editor}
          </GradientBorder>
        ) : (
          <div className="qivryn-transcript-input-frame">{editor}</div>
        )}
        {showTranscriptActions && (
          <div
            className="qivryn-transcript-actions"
            aria-label="Message actions"
          >
            <button
              type="button"
              className="qivryn-transcript-action-button"
              aria-label="Edit message"
              title="Edit message"
              aria-pressed={isTranscriptEditing}
              onMouseDown={handleActionMouseDown}
              onClick={handleEditMessage}
              disabled={isStreaming}
            >
              <PencilSquareIcon aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {(appliedRules.length > 0 || contextItems.length > 0) && (
        <div
          className={`mt-2 flex flex-col ${isMainInput ? "" : "qivryn-transcript-context-peek"}`}
        >
          <RulesPeek appliedRules={props.appliedRules} />
          <ContextItemsPeek
            contextItems={props.contextItems}
            isCurrentContextPeek={props.isLastUserInput}
          />
        </div>
      )}
    </div>
  );
}

export default memo(QivrynInputBox);
