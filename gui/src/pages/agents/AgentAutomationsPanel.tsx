import type {
  AgentAutomation,
  AgentAutomationControlRequest,
  AgentRun,
  AgentAutomationTrigger,
  AgentPermissionMode,
} from "@qivryn/agent-runtime";
import {
  ArrowLeftIcon,
  ClockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { formatReasoningEffort } from "../../components/modelSelection/reasoningEffortLabels";

const WEEKDAYS = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
] as const;

function triggerLabel(trigger: AgentAutomationTrigger): string {
  if (trigger.type === "manual") return "Manual";
  if (trigger.type === "interval") {
    return `Every ${trigger.everyMinutes} min`;
  }
  if (trigger.type === "daily") return `Daily at ${trigger.at}`;
  if (trigger.type === "rrule") return trigger.rrule.replace(/^RRULE:/i, "");
  const labels = trigger.daysOfWeek
    .map((day) => WEEKDAYS.find((weekday) => weekday.value === day)?.label)
    .filter(Boolean)
    .join(" ");
  return `${labels} at ${trigger.at}`;
}

function reasoningLevels(model: unknown): string[] {
  const extra = (model as any)?.requestOptions?.extraBodyProperties as
    | Record<string, unknown>
    | undefined;
  return Array.isArray(extra?._reasoningLevels)
    ? extra._reasoningLevels.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

function defaultReasoningEffort(model: unknown, levels: string[]): string {
  const extra = (model as any)?.requestOptions?.extraBodyProperties as
    | Record<string, unknown>
    | undefined;
  const configured = extra?.reasoning_effort;
  if (typeof configured === "string" && levels.includes(configured)) {
    return configured;
  }
  return levels.includes("medium") ? "medium" : (levels[0] ?? "");
}

function automationRunId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<AgentRun & AgentAutomation>;
  if (typeof record.id === "string" && "workspace" in record) {
    return record.id;
  }
  return typeof record.lastRunId === "string" ? record.lastRunId : undefined;
}

export function AgentAutomationsPanel({
  defaultRepository,
  onClose,
  onRunStarted,
  onOpenRun,
}: {
  defaultRepository: string;
  onClose: () => void;
  onRunStarted: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const chatModels = useAppSelector(
    (state) => state.config.config.modelsByRole.chat,
  );
  const reasoningSettings = useAppSelector(
    (state) => state.ui.reasoningEffortSettings,
  );
  const [items, setItems] = useState<AgentAutomation[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repository, setRepository] = useState(defaultRepository);
  const [minutes, setMinutes] = useState("60");
  const [triggerType, setTriggerType] =
    useState<AgentAutomationTrigger["type"]>("interval");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [rrule, setRrule] = useState("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [permissionMode, setPermissionMode] =
    useState<AgentPermissionMode>("autonomous");
  const [model, setModel] = useState(selectedModel?.title ?? "");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [showDraft, setShowDraft] = useState(false);
  const [editingId, setEditingId] = useState<string>();

  const load = useCallback(async () => {
    const response = await ideMessenger.request(
      "agents/automations",
      undefined,
    );
    if (response.status === "success") {
      setItems(response.content);
      if (response.content.length === 0) {
        setShowDraft(true);
      }
      setSelectedId((current) =>
        current && response.content.some((item) => item.id === current)
          ? current
          : response.content[0]?.id,
      );
    } else setError(response.error);
  }, [ideMessenger]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!model && selectedModel?.title) setModel(selectedModel.title);
  }, [model, selectedModel]);

  const activeModel = useMemo(
    () =>
      chatModels.find((candidate) => candidate.title === model) ??
      selectedModel,
    [chatModels, model, selectedModel],
  );
  const availableReasoning = useMemo(
    () => reasoningLevels(activeModel),
    [activeModel],
  );

  useEffect(() => {
    if (!activeModel?.title) {
      setReasoningEffort("");
      return;
    }
    if (reasoningEffort && availableReasoning.includes(reasoningEffort)) return;
    setReasoningEffort(
      reasoningSettings[activeModel.title] ??
        defaultReasoningEffort(activeModel, availableReasoning),
    );
  }, [activeModel, availableReasoning, reasoningEffort, reasoningSettings]);

  const control = async (request: AgentAutomationControlRequest) => {
    setError(undefined);
    const response = await ideMessenger.request(
      "agents/automationControl",
      request,
    );
    if (response.status === "error") {
      setError(response.error);
      return undefined;
    }
    await load();
    return response.content;
  };

  const selected = items.find((item) => item.id === selectedId);

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const interval = Number(minutes);
    if (
      triggerType === "interval" &&
      (!Number.isFinite(interval) || interval <= 0)
    ) {
      setError("Interval must be greater than zero minutes.");
      setBusy(false);
      return;
    }
    if (triggerType === "weekly" && daysOfWeek.length === 0) {
      setError("Select at least one weekday.");
      setBusy(false);
      return;
    }
    const trigger: AgentAutomationTrigger =
      triggerType === "manual"
        ? { type: "manual" }
        : triggerType === "interval"
          ? { type: "interval", everyMinutes: interval }
          : triggerType === "daily"
            ? { type: "daily", at: scheduleTime }
            : triggerType === "weekly"
              ? { type: "weekly", at: scheduleTime, daysOfWeek }
              : { type: "rrule", rrule: rrule.trim() };
    const request = {
      name,
      prompt,
      repositoryPath: repository,
      permissionMode,
      model: model || undefined,
      reasoningEffort: reasoningEffort || undefined,
      trigger,
    };
    const saved = await control(
      editingId
        ? { action: "update", automationId: editingId, request }
        : { action: "create", request },
    );
    if (saved) {
      setName("");
      setPrompt("");
      setShowDraft(false);
      setEditingId(undefined);
    }
    setBusy(false);
  };

  const editAutomation = (automation: AgentAutomation) => {
    setEditingId(automation.id);
    setName(automation.name);
    setPrompt(automation.prompt);
    setRepository(automation.repositoryPath);
    setPermissionMode(automation.permissionMode);
    setModel(automation.model ?? selectedModel?.title ?? "");
    setReasoningEffort(automation.reasoningEffort ?? "");
    setTriggerType(automation.trigger.type);
    if (automation.trigger.type === "interval") {
      setMinutes(String(automation.trigger.everyMinutes));
    }
    if (
      automation.trigger.type === "daily" ||
      automation.trigger.type === "weekly"
    ) {
      setScheduleTime(automation.trigger.at);
    }
    if (automation.trigger.type === "weekly") {
      setDaysOfWeek(automation.trigger.daysOfWeek);
    }
    if (automation.trigger.type === "rrule") {
      setRrule(automation.trigger.rrule);
    }
    setShowDraft(true);
  };

  return (
    <section
      role="dialog"
      aria-label="Scheduled agent tasks"
      className="qivryn-automations-page bg-background absolute inset-0 z-[60] flex min-h-0 flex-col overflow-hidden"
    >
      <header className="qivryn-automations-page-header border-input flex h-14 flex-shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          aria-label="Back to agents"
          onClick={onClose}
          className="hover:bg-list-hover flex h-8 w-8 items-center justify-center rounded-lg border-none bg-transparent"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-medium">Scheduled tasks</h2>
          <p className="text-description m-0 hidden truncate text-xs min-[560px]:block">
            Ask Qivryn to schedule tasks, set reminders, or monitor for updates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(undefined);
            setShowDraft(true);
          }}
          className="qivryn-neutral-primary flex h-8 items-center gap-1.5 rounded-lg border-none px-3 text-xs font-medium"
        >
          <PlusIcon className="h-4 w-4" />
          <span>New task</span>
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="border-error text-error border-b px-4 py-2 text-xs"
        >
          {error}
        </div>
      )}

      <div className="qivryn-automations-layout grid min-h-0 flex-1 grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <aside className="border-input min-h-0 overflow-y-auto border-r p-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-selected={selectedId === item.id && !showDraft}
              onClick={() => {
                setSelectedId(item.id);
                setShowDraft(false);
              }}
              className="qivryn-automation-list-row hover:bg-list-hover mb-0.5 flex min-h-14 w-full items-center gap-2 rounded-lg border-none bg-transparent px-2.5 py-2 text-left"
            >
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full ${item.enabled ? "bg-success" : "bg-description-muted opacity-40"}`}
              />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-xs font-medium">
                  {item.name}
                </strong>
                <span className="text-description text-2xs block truncate">
                  {triggerLabel(item.trigger)}
                </span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <div className="text-description px-3 py-10 text-center text-xs">
              No scheduled tasks yet.
            </div>
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {showDraft ? (
            <form
              aria-label="Create scheduled task"
              onSubmit={submitDraft}
              className="qivryn-automation-editor mx-auto box-border w-full max-w-2xl p-6"
            >
              <div className="mb-6">
                <h3 className="m-0 text-xl font-medium">
                  {editingId ? "Edit scheduled task" : "Create scheduled task"}
                </h3>
                <p className="text-description mb-0 mt-1 text-xs">
                  The task runs in its own durable conversation and keeps its
                  original workspace context.
                </p>
              </div>
              <label className="qivryn-field-label">
                <span>Name</span>
                <input
                  autoFocus
                  aria-label="Scheduled task name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Daily repository review"
                />
              </label>
              <label className="qivryn-field-label">
                <span>Instructions</span>
                <textarea
                  aria-label="Scheduled task prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What should Qivryn do?"
                  rows={6}
                />
              </label>
              <label className="qivryn-field-label">
                <span>Workspace</span>
                <input
                  aria-label="Scheduled task repository"
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  placeholder="Workspace or repository path"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-2">
                <label className="qivryn-field-label">
                  <span>Schedule</span>
                  <select
                    aria-label="Automation schedule type"
                    value={triggerType}
                    onChange={(event) =>
                      setTriggerType(
                        event.target.value as AgentAutomationTrigger["type"],
                      )
                    }
                  >
                    <option value="manual">Manual</option>
                    <option value="interval">Interval</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="rrule">Advanced RRULE</option>
                  </select>
                </label>
                <label className="qivryn-field-label">
                  <span>Permissions</span>
                  <select
                    aria-label="Automation permission mode"
                    value={permissionMode}
                    onChange={(event) =>
                      setPermissionMode(
                        event.target.value as AgentPermissionMode,
                      )
                    }
                  >
                    <option value="ask">Ask before changes</option>
                    <option value="autonomous">Autonomous</option>
                    <option value="fullAccess">Full access</option>
                    <option value="readOnly">Read only</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-2">
                <label className="qivryn-field-label">
                  <span>Model</span>
                  <select
                    aria-label="Automation model"
                    value={model}
                    onChange={(event) => {
                      const next = event.target.value;
                      setModel(next);
                      const nextModel = chatModels.find(
                        (candidate) => candidate.title === next,
                      );
                      const levels = reasoningLevels(nextModel);
                      setReasoningEffort(
                        reasoningSettings[next] ??
                          defaultReasoningEffort(nextModel, levels),
                      );
                    }}
                  >
                    {chatModels.length === 0 && (
                      <option value="">Current default</option>
                    )}
                    {chatModels.map((candidate) => (
                      <option key={candidate.title} value={candidate.title}>
                        {candidate.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="qivryn-field-label">
                  <span>Reasoning</span>
                  <select
                    aria-label="Automation reasoning"
                    value={reasoningEffort}
                    disabled={availableReasoning.length === 0}
                    onChange={(event) => setReasoningEffort(event.target.value)}
                  >
                    {availableReasoning.length === 0 && (
                      <option value="">Provider default</option>
                    )}
                    {availableReasoning.map((effort) => (
                      <option key={effort} value={effort}>
                        {formatReasoningEffort(effort)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {triggerType === "interval" && (
                <label className="qivryn-field-label">
                  <span>Every (minutes)</span>
                  <input
                    aria-label="Interval minutes"
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    type="number"
                    min={1}
                  />
                </label>
              )}
              {(triggerType === "daily" || triggerType === "weekly") && (
                <label className="qivryn-field-label">
                  <span>Local time</span>
                  <input
                    aria-label="Automation local time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    type="time"
                  />
                </label>
              )}
              {triggerType === "weekly" && (
                <div className="qivryn-field-label">
                  <span>Days</span>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day, index) => {
                      const active = daysOfWeek.includes(day.value);
                      return (
                        <button
                          key={`${day.value}-${index}`}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setDaysOfWeek((current) =>
                              active
                                ? current.filter((value) => value !== day.value)
                                : [...current, day.value],
                            )
                          }
                          className="qivryn-weekday-button"
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {triggerType === "rrule" && (
                <label className="qivryn-field-label">
                  <span>RRULE</span>
                  <input
                    aria-label="Automation RRULE"
                    value={rrule}
                    onChange={(event) => setRrule(event.target.value)}
                    placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
                  />
                </label>
              )}
              <div className="border-input mt-6 flex items-center justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowDraft(false);
                    setEditingId(undefined);
                  }}
                  className="hover:bg-list-hover h-8 rounded-lg border-none bg-transparent px-3 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  aria-label={editingId ? "Save scheduled task" : "Create"}
                  disabled={
                    busy || !name.trim() || !prompt.trim() || !repository.trim()
                  }
                  className="qivryn-neutral-primary h-8 rounded-lg border-none px-3 text-xs font-medium disabled:opacity-50"
                >
                  {busy
                    ? editingId
                      ? "Saving…"
                      : "Creating…"
                    : editingId
                      ? "Save task"
                      : "Create task"}
                </button>
              </div>
            </form>
          ) : selected ? (
            <article className="qivryn-automation-detail mx-auto box-border w-full max-w-3xl p-6">
              <header className="border-input flex items-start gap-4 border-b pb-5">
                <span className="qivryn-automation-detail-icon">
                  <ClockIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 text-xl font-medium">{selected.name}</h3>
                  <p className="text-description mb-0 mt-1 text-xs">
                    {triggerLabel(selected.trigger)}
                    {selected.nextRunAt
                      ? ` · Next ${new Date(selected.nextRunAt).toLocaleString()}`
                      : " · Paused"}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Edit ${selected.name}`}
                    title="Edit scheduled task"
                    onClick={() => editAutomation(selected)}
                    className="border-input hover:bg-list-hover h-8 rounded-lg border bg-transparent px-3 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`${selected.enabled ? "Pause" : "Resume"} ${selected.name}`}
                    onClick={() =>
                      void control({
                        action: "enabled",
                        automationId: selected.id,
                        enabled: !selected.enabled,
                      })
                    }
                    className="border-input hover:bg-list-hover flex h-8 items-center gap-1.5 rounded-lg border bg-transparent px-3 text-xs"
                  >
                    {selected.enabled ? (
                      <PauseIcon className="h-4 w-4" />
                    ) : (
                      <PlayIcon className="h-4 w-4" />
                    )}
                    {selected.enabled ? "Pause" : "Resume"}
                  </button>
                </div>
              </header>
              <section className="border-input border-b py-5">
                <h4 className="mb-2 mt-0 text-xs font-medium">Instructions</h4>
                <p className="m-0 whitespace-pre-wrap text-sm leading-6">
                  {selected.prompt}
                </p>
              </section>
              <dl className="qivryn-automation-metadata border-input m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-y-3 border-b py-5 text-xs">
                <dt>Workspace</dt>
                <dd title={selected.repositoryPath}>
                  {selected.repositoryPath}
                </dd>
                <dt>Model</dt>
                <dd>{selected.model ?? "Current default"}</dd>
                <dt>Reasoning</dt>
                <dd>
                  {selected.reasoningEffort
                    ? formatReasoningEffort(selected.reasoningEffort)
                    : "Provider default"}
                </dd>
                <dt>Permissions</dt>
                <dd>{selected.permissionMode}</dd>
                <dt>Last run</dt>
                <dd>
                  {selected.lastRunAt
                    ? new Date(selected.lastRunAt).toLocaleString()
                    : "Never"}
                </dd>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-5">
                <button
                  type="button"
                  onClick={() =>
                    void control({
                      action: "remove",
                      automationId: selected.id,
                    })
                  }
                  className="text-error hover:bg-list-hover flex h-8 items-center gap-1.5 rounded-lg border-none bg-transparent px-2 text-xs"
                >
                  <TrashIcon className="h-4 w-4" /> Delete
                </button>
                <div className="flex items-center gap-2">
                  {selected.lastRunId && (
                    <button
                      type="button"
                      onClick={() => onOpenRun(selected.lastRunId!)}
                      className="border-input hover:bg-list-hover h-8 rounded-lg border bg-transparent px-3 text-xs"
                    >
                      Open last run
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Run ${selected.name}`}
                    onClick={() =>
                      void control({
                        action: "run",
                        automationId: selected.id,
                      }).then((ok) => {
                        const runId = automationRunId(ok);
                        if (runId) {
                          onOpenRun(runId);
                          return;
                        }
                        onRunStarted();
                      })
                    }
                    className="qivryn-neutral-primary flex h-8 items-center gap-1.5 rounded-lg border-none px-3 text-xs font-medium"
                  >
                    <PlayIcon className="h-4 w-4" /> Run now
                  </button>
                </div>
              </div>
            </article>
          ) : (
            <div className="qivryn-automation-empty flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="qivryn-automation-detail-icon mb-4">
                <ClockIcon className="h-5 w-5" />
              </span>
              <h3 className="m-0 text-lg font-medium">
                Schedule recurring work
              </h3>
              <p className="text-description mb-5 mt-1 max-w-md text-xs leading-5">
                Create a durable task that can run now, on an interval, or on a
                daily or weekly schedule.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingId(undefined);
                  setShowDraft(true);
                }}
                className="bg-button text-button-foreground flex h-8 items-center gap-1.5 rounded-lg border-none px-3 text-xs font-medium"
              >
                <PlusIcon className="h-4 w-4" /> New task
              </button>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
