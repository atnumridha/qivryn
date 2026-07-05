import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { CONFIG_ROUTES } from "../../../util/navigation";

export function OnboardingFeatureTour() {
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);
  const items = [
    {
      title: "Inline Edit",
      detail: "Select code and press Ctrl/Cmd+I",
      action: () => ideMessenger.post("focusEditor", undefined),
    },
    {
      title: "Tab & Next Edit",
      detail: "Accept suggestions and jump with Tab",
      action: () => ideMessenger.post("focusEditor", undefined),
    },
    {
      title: "Privacy",
      detail: "Choose local models and telemetry controls",
      action: () => navigate(CONFIG_ROUTES.SETTINGS),
    },
    {
      title: "Skills",
      detail: "Inspect global cross-agent skills",
      action: () => navigate(CONFIG_ROUTES.EXTENSIONS),
    },
    {
      title: "MCP",
      detail: "Authorize local and remote tool servers",
      action: () => navigate(CONFIG_ROUTES.TOOLS),
    },
  ];
  return (
    <section
      aria-label="Qivryn feature tour"
      className="border-input mt-3 border-t pt-2"
    >
      <div className="mb-1 flex items-center gap-2">
        <strong className="text-xs">Local development tour</strong>
        <button
          onClick={() =>
            ideMessenger.post("onboarding/importVsCode", undefined)
          }
          className="text-link text-2xs ml-auto border-none bg-transparent underline"
        >
          Import VS Code profile
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {items.map((item) => (
          <button
            key={item.title}
            onClick={item.action}
            className="border-input bg-input min-w-0 rounded border p-2 text-left"
          >
            <span className="block text-xs font-medium">{item.title}</span>
            <span className="text-description-muted text-2xs block">
              {item.detail}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
