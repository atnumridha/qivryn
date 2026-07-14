import {
  BeakerIcon,
  CalendarDaysIcon,
  CodeBracketSquareIcon,
  CodeBracketIcon,
  CommandLineIcon,
  DocumentMagnifyingGlassIcon,
  SquaresPlusIcon,
} from "@heroicons/react/24/outline";
import type { JSONContent } from "@tiptap/react";
import { useNavigate } from "react-router-dom";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";
import { useAppDispatch } from "../../redux/hooks";
import { setMainEditorContentTrigger } from "../../redux/slices/sessionSlice";
import { ROUTES } from "../../util/navigation";

const starterPrompts = [
  {
    label: "Review Current File",
    description: "Find bugs, edge cases, and risky changes.",
    prompt: "Review the current file for bugs, edge cases, and risky changes.",
    Icon: DocumentMagnifyingGlassIcon,
  },
  {
    label: "Find Failing Test",
    description: "Trace the failure and propose the smallest fix.",
    prompt:
      "Find the failing test path, explain the failure, and propose the smallest fix.",
    Icon: BeakerIcon,
  },
  {
    label: "Explain Error",
    description: "Ground the cause in workspace evidence.",
    prompt:
      "Explain the current error from the workspace evidence and point to the likely code path.",
    Icon: CommandLineIcon,
  },
  {
    label: "Create Patch",
    description: "Make the focused change and run relevant checks.",
    prompt:
      "Create a focused patch for this task, then run the relevant checks.",
    Icon: CodeBracketIcon,
  },
];

function promptToEditorState(prompt: string): JSONContent {
  return {
    type: "doc",
    content: prompt.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : undefined,
    })),
  };
}

export function EmptyChatBody() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { mainEditor } = useMainEditor();
  const workspaceName = window.workspacePaths?.[0]
    ?.replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);

  function insertStarter(prompt: string) {
    if (!mainEditor) {
      dispatch(setMainEditorContentTrigger(promptToEditorState(prompt)));
      return;
    }

    mainEditor.commands.clearContent();
    mainEditor.commands.insertContent(prompt);
    mainEditor.commands.focus("end");
  }

  function insertParallelTemplate() {
    insertStarter(
      [
        "Run in parallel:",
        "Review the current workspace changes",
        "Run the relevant validation checks",
        "Audit the UI for alignment, spacing, and overflow issues",
      ].join("\n"),
    );
  }

  const actions = [
    ...starterPrompts.map(({ label, description, prompt, Icon }) => ({
      label,
      description,
      Icon,
      onClick: () => insertStarter(prompt),
    })),
    {
      label: "Run in parallel",
      description: "Prefill independent outcomes in the composer.",
      Icon: SquaresPlusIcon,
      onClick: insertParallelTemplate,
    },
    {
      label: "Schedule",
      description: "Open the scheduled task builder.",
      Icon: CalendarDaysIcon,
      onClick: () => navigate(`${ROUTES.AGENTS}?scheduled=1`),
    },
  ];

  return (
    <div className="qivryn-chat-empty-state">
      <section
        className="qivryn-chat-empty-panel"
        aria-labelledby="qivryn-empty-title"
      >
        <CodeBracketSquareIcon
          className="qivryn-empty-mark"
          aria-hidden="true"
        />
        <h1 id="qivryn-empty-title">
          {workspaceName
            ? `What should we work on in ${workspaceName}?`
            : "What should we work on?"}
        </h1>
        <p className="qivryn-empty-supporting-copy">
          Start with a question, a file, or a change in this workspace.
        </p>

        <div
          className="qivryn-empty-starters"
          role="group"
          aria-label="Starter prompts"
        >
          {actions.map(({ label, description, onClick, Icon }) => (
            <button
              key={label}
              type="button"
              className="qivryn-empty-starter-row"
              onClick={onClick}
              title={description}
            >
              <span className="qivryn-empty-starter-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="qivryn-empty-starter-label">{label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
