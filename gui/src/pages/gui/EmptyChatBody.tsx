import { ConversationStarterCards } from "../../components/ConversationStarters";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";

const starterPrompts = [
  {
    label: "Review Current File",
    description: "Find bugs, edge cases, and risky changes.",
    prompt: "Review the current file for bugs, edge cases, and risky changes.",
  },
  {
    label: "Find Failing Test",
    description: "Trace the failure and propose the smallest fix.",
    prompt:
      "Find the failing test path, explain the failure, and propose the smallest fix.",
  },
  {
    label: "Explain Error",
    description: "Ground the cause in workspace evidence.",
    prompt:
      "Explain the current error from the workspace evidence and point to the likely code path.",
  },
  {
    label: "Create Patch",
    description: "Make the focused change and run relevant checks.",
    prompt:
      "Create a focused patch for this task, then run the relevant checks.",
  },
];

export function EmptyChatBody() {
  const { mainEditor } = useMainEditor();

  function insertStarter(prompt: string) {
    if (!mainEditor) {
      return;
    }

    mainEditor.commands.clearContent();
    mainEditor.commands.insertContent(prompt);
    mainEditor.commands.focus("end");
  }

  return (
    <div className="qivryn-chat-empty-state">
      <section
        className="qivryn-chat-empty-panel"
        aria-labelledby="qivryn-empty-title"
      >
        <div className="qivryn-empty-status" aria-label="Agent Ready">
          <span className="qivryn-empty-status-dot" aria-hidden="true" />
          <span>Agent Ready</span>
        </div>
        <h1 id="qivryn-empty-title">What do you want to change?</h1>

        <div
          className="qivryn-empty-starters"
          role="group"
          aria-label="Starter prompts"
        >
          {starterPrompts.map(({ label, description, prompt }, index) => (
            <button
              key={label}
              type="button"
              className="qivryn-empty-starter-row"
              onClick={() => insertStarter(prompt)}
            >
              <span className="qivryn-empty-starter-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span>{label}</span>
                <span>{description}</span>
              </span>
              <span className="qivryn-empty-starter-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>

        <ConversationStarterCards />
      </section>
    </div>
  );
}
