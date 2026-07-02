import type {
  AgentAutomation,
  AgentAutomationControlRequest,
  AgentPermissionMode,
} from "@qivryn/agent-runtime";
import { PlayIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";

export function AgentAutomationsPanel({
  defaultRepository,
  onClose,
  onRunStarted,
}: {
  defaultRepository: string;
  onClose: () => void;
  onRunStarted: () => void;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const [items, setItems] = useState<AgentAutomation[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repository, setRepository] = useState(defaultRepository);
  const [minutes, setMinutes] = useState("60");
  const [manual, setManual] = useState(false);
  const [permissionMode, setPermissionMode] =
    useState<AgentPermissionMode>("autonomous");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const response = await ideMessenger.request(
      "agents/automations",
      undefined,
    );
    if (response.status === "success") setItems(response.content);
    else setError(response.error);
  }, [ideMessenger]);

  useEffect(() => void load(), [load]);

  const control = async (request: AgentAutomationControlRequest) => {
    setError(undefined);
    const response = await ideMessenger.request(
      "agents/automationControl",
      request,
    );
    if (response.status === "error") {
      setError(response.error);
      return false;
    }
    await load();
    return true;
  };

  return (
    <div
      role="dialog"
      aria-label="Agent automations"
      className="border-input bg-background fixed left-1/2 top-14 z-[60] box-border flex max-h-[calc(100vh-80px)] w-[min(760px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl"
    >
      <header className="border-input flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold">Automations</h2>
          <div className="text-description mt-0.5 text-xs">
            Run local agents manually or on a persisted interval.
          </div>
        </div>
        <button
          type="button"
          aria-label="Close automations"
          onClick={onClose}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 overflow-y-auto p-4">
        <form
          className="border-input bg-editor grid min-w-0 grid-cols-1 gap-2 rounded-lg border p-3 min-[620px]:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            const interval = Number(minutes);
            if (!manual && (!Number.isFinite(interval) || interval <= 0)) {
              setError("Interval must be greater than zero minutes.");
              setBusy(false);
              return;
            }
            const created = await control({
              action: "create",
              request: {
                name,
                prompt,
                repositoryPath: repository,
                permissionMode,
                model: selectedModel?.title,
                trigger: manual
                  ? { type: "manual" }
                  : { type: "interval", everyMinutes: interval },
              },
            });
            if (created) {
              setName("");
              setPrompt("");
            }
            setBusy(false);
          }}
        >
          <input
            aria-label="Automation name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Automation name"
            className="border-input bg-input rounded-md border px-2 py-1.5 text-xs outline-none"
          />
          <input
            aria-label="Automation repository"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="Repository path"
            className="border-input bg-input rounded-md border px-2 py-1.5 text-xs outline-none"
          />
          <textarea
            aria-label="Automation prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What should this agent do?"
            rows={3}
            className="border-input bg-input resize-y rounded-md border px-2 py-1.5 text-xs outline-none min-[620px]:col-span-2"
          />
          <div className="flex min-w-0 items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={manual}
                onChange={(event) => setManual(event.target.checked)}
              />
              Manual only
            </label>
            {!manual && (
              <input
                aria-label="Interval minutes"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                type="number"
                min={1}
                className="border-input bg-input min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"
              />
            )}
          </div>
          <div className="flex min-w-0 gap-2">
            <select
              aria-label="Automation permission mode"
              value={permissionMode}
              onChange={(event) =>
                setPermissionMode(event.target.value as AgentPermissionMode)
              }
              className="border-input bg-input min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"
            >
              <option value="ask">Ask</option>
              <option value="autonomous">Autonomous</option>
              <option value="fullAccess">Full access</option>
              <option value="readOnly">Read only</option>
            </select>
            <button
              type="submit"
              disabled={
                busy || !name.trim() || !prompt.trim() || !repository.trim()
              }
              className="bg-button text-button-foreground rounded-md border-none px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <div className="text-description text-2xs truncate min-[620px]:col-span-2">
            Model: {selectedModel?.title ?? "Current chat model"}
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="border-error text-error mt-3 rounded-md border p-2 text-xs"
          >
            {error}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {items.length === 0 && (
            <div className="text-description py-8 text-center text-xs">
              No local automations yet.
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="border-input bg-editor flex min-w-0 items-center gap-2 rounded-lg border p-3"
            >
              <button
                type="button"
                aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.name}`}
                onClick={() =>
                  void control({
                    action: "enabled",
                    automationId: item.id,
                    enabled: !item.enabled,
                  })
                }
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full border-none ${item.enabled ? "bg-success" : "bg-description-muted"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{item.name}</div>
                <div className="text-description text-2xs truncate">
                  {item.trigger.type === "interval"
                    ? `Every ${item.trigger.everyMinutes} min · next ${item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : "paused"}`
                    : "Manual"}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Run ${item.name}`}
                title="Run now"
                onClick={() =>
                  void control({ action: "run", automationId: item.id }).then(
                    (ok) => {
                      if (ok) onRunStarted();
                    },
                  )
                }
                className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
              >
                <PlayIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${item.name}`}
                onClick={() =>
                  void control({ action: "remove", automationId: item.id })
                }
                className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
