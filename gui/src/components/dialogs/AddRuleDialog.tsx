import { useContext, useLayoutEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Input, SecondaryButton } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";

type RuleApplicationMode = "always" | "auto" | "agent" | "manual";

const ruleModes: Array<{
  value: RuleApplicationMode;
  label: string;
  description: string;
}> = [
  {
    value: "always",
    label: "Always apply",
    description: "Included in every chat, plan, and agent request.",
  },
  {
    value: "auto",
    label: "Match files",
    description: "Included when matching files are referenced.",
  },
  {
    value: "agent",
    label: "Agent decides",
    description: "Available when the agent determines the description applies.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Only included when explicitly mentioned with @.",
  },
];

function AddRuleDialog({ mode }: { mode: "workspace" | "global" }) {
  const dispatch = useDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const [name, setName] = useState("new-rule");
  const [ruleType, setRuleType] = useState<RuleApplicationMode>("always");
  const [description, setDescription] = useState("");
  const [globs, setGlobs] = useState("**/*.{ts,tsx,js,jsx}");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    // focus on input after a short delay
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const closeDialog = () => {
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Rule name is required");
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    const payload = {
      baseFilename: trimmed,
      ruleType,
      description: description.trim() || undefined,
      globs: ruleType === "auto" ? globs.trim() || undefined : undefined,
    };
    try {
      if (mode === "global") {
        ideMessenger.post("config/addGlobalRule", payload);
      } else {
        ideMessenger.post("config/addLocalWorkspaceBlock", {
          blockType: "rules",
          ...payload,
        });
      }
      closeDialog();
    } catch (err) {
      setIsSubmitting(false);
      setError("Failed to create rule file");
    }
  };

  const title = mode === "global" ? "Add global rule" : "Add workspace rule";

  return (
    <div className="px-2 pt-4 sm:px-4">
      <div>
        <h1 className="mb-0">{title}</h1>
        <p className="m-0 mt-2 p-0 text-stone-500">
          Choose how this rule should enter model context.
        </p>
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <label className="flex w-full flex-col gap-1">
            <span>Rule name</span>
            <Input
              ref={inputRef}
              type="text"
              placeholder="ex: api-guidelines"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span>Application mode</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ruleModes.map((option) => {
                const isSelected = ruleType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRuleType(option.value)}
                    className={`border-border bg-input text-vsc-foreground hover:bg-list-hover flex flex-col rounded-md border px-3 py-2 text-left transition-colors ${
                      isSelected ? "border-vsc-focusBorder brightness-110" : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="mt-1 text-xs text-stone-500">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {(ruleType === "auto" || ruleType === "agent") && (
            <label className="flex w-full flex-col gap-1">
              <span>Description</span>
              <Input
                type="text"
                placeholder="ex: React component architecture and tests"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          )}
          {ruleType === "auto" && (
            <label className="flex w-full flex-col gap-1">
              <span>File globs</span>
              <Input
                type="text"
                placeholder="ex: **/*.tsx, **/*.css"
                value={globs}
                onChange={(e) => setGlobs(e.target.value)}
              />
            </label>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="mt-2 flex flex-row justify-end gap-2">
            <SecondaryButton
              className="min-w-16"
              disabled={isSubmitting}
              type="submit"
            >
              Create
            </SecondaryButton>
            <SecondaryButton
              type="button"
              className="min-w-16"
              onClick={closeDialog}
            >
              Cancel
            </SecondaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddRuleDialog;
