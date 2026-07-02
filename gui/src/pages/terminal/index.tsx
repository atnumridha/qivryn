import type {
  TerminalCommandClassification,
  TerminalJob,
  ToolPolicy,
} from "@continuedev/terminal-security";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CommandLineIcon,
  PaperAirplaneIcon,
  ShieldCheckIcon,
  StopIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch } from "../../redux/hooks";
import { setMainEditorContentTrigger } from "../../redux/slices/sessionSlice";
import { ROUTES } from "../../util/navigation";

function TerminalAssistant() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [terminalOutput, setTerminalOutput] = useState("");
  const [command, setCommand] = useState("");
  const [basePolicy, setBasePolicy] = useState<ToolPolicy>(
    "allowedWithoutPermission",
  );
  const [sandboxed, setSandboxed] = useState(true);
  const [classification, setClassification] =
    useState<TerminalCommandClassification>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [jobs, setJobs] = useState<TerminalJob[]>([]);

  const loadJobs = useCallback(async () => {
    const response = await ideMessenger.request("terminal/jobs", undefined);
    if (response.status === "success") setJobs(response.content);
  }, [ideMessenger]);

  const loadOutput = useCallback(async () => {
    try {
      setTerminalOutput(await ideMessenger.ide.getTerminalContents());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [ideMessenger]);

  useEffect(() => {
    void loadOutput();
    void loadJobs();
  }, [loadJobs, loadOutput]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadJobs(), 1_000);
    return () => window.clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    if (!command.trim()) {
      setClassification(undefined);
      return;
    }
    const timer = window.setTimeout(() => {
      void ideMessenger
        .request("terminal/classify", {
          command,
          basePolicy,
          sandboxed,
        })
        .then((response) => {
          if (response.status === "success")
            setClassification(response.content);
          else setError(response.error);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [basePolicy, command, ideMessenger, sandboxed]);

  const addToChat = (instruction: string) => {
    const text = terminalOutput.trim() || command.trim();
    dispatch(
      setMainEditorContentTrigger({
        type: "doc",
        content: [instruction, text].filter(Boolean).map((value) => ({
          type: "paragraph",
          content: [{ type: "text", text: value }],
        })),
      }),
    );
    navigate(ROUTES.HOME);
  };

  const execute = async () => {
    if (!classification || classification.policy === "disabled") return;
    if (sandboxed) {
      setError(
        "Sandboxed commands run through an Autonomous agent. Turn off Sandbox to run this preview in the host terminal.",
      );
      return;
    }
    setRunning(true);
    setError(undefined);
    try {
      await ideMessenger.ide.runCommand(command, {
        reuseTerminal: true,
        terminalName: "Continue Agent",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const startBackground = async () => {
    if (!classification || classification.policy === "disabled") return;
    const directories = await ideMessenger.request(
      "getWorkspaceDirs",
      undefined,
    );
    if (directories.status === "error" || !directories.content[0]) {
      setError("Open a workspace before starting a background job.");
      return;
    }
    const response = await ideMessenger.request("terminal/jobStart", {
      command,
      cwd: directories.content[0].replace(/^file:\/\//, ""),
    });
    if (response.status === "error") setError(response.error);
    else await loadJobs();
  };

  return (
    <div className="bg-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="border-input flex h-10 flex-shrink-0 items-center gap-2 border-b px-2">
        <button
          aria-label="Back to chat"
          onClick={() => navigate(ROUTES.HOME)}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
          Terminal Assistant
        </h1>
        <button
          aria-label="Refresh terminal output"
          onClick={() => void loadOutput()}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
        >
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(100px,0.8fr)_auto_minmax(130px,1fr)] overflow-hidden min-[720px]:grid-cols-2 min-[720px]:grid-rows-[auto_minmax(0,1fr)]">
        <section className="border-input min-h-0 min-w-0 border-b p-2 min-[720px]:row-span-2 min-[720px]:border-b-0 min-[720px]:border-r">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold">Terminal output</span>
            <span className="text-description-muted text-2xs ml-auto">
              read only
            </span>
          </div>
          <pre
            aria-label="Terminal output"
            className="border-input bg-input text-2xs m-0 box-border h-[calc(100%-24px)] max-h-full min-h-20 w-full overflow-auto whitespace-pre-wrap break-words rounded border p-2"
          >
            {terminalOutput || "No terminal output is available."}
          </pre>
        </section>

        <section className="border-input grid min-w-0 grid-cols-2 gap-1 border-b p-2 min-[440px]:grid-cols-4">
          <button
            onClick={() =>
              addToChat(
                "Explain this terminal failure and identify the root cause.",
              )
            }
            className="border-input hover:bg-list-hover text-2xs flex items-center justify-center gap-1 rounded border bg-transparent px-2 py-1.5"
          >
            <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
            Explain Failure
          </button>
          <button
            onClick={() =>
              addToChat(
                "Give a second opinion on this terminal output. Challenge the likely diagnosis.",
              )
            }
            className="border-input hover:bg-list-hover text-2xs flex items-center justify-center gap-1 rounded border bg-transparent px-2 py-1.5"
          >
            <ShieldCheckIcon className="h-3.5 w-3.5" />
            Second Opinion
          </button>
          <button
            onClick={() =>
              addToChat(
                "Generate a shell-safe command for this task. Explain the command before proposing it.",
              )
            }
            className="border-input hover:bg-list-hover text-2xs flex items-center justify-center gap-1 rounded border bg-transparent px-2 py-1.5"
          >
            <CommandLineIcon className="h-3.5 w-3.5" />
            Generate Command
          </button>
          <button
            onClick={() =>
              addToChat(
                "Fix the failed command shown below. Preserve shell quoting and minimize side effects.",
              )
            }
            className="border-input hover:bg-list-hover text-2xs flex items-center justify-center gap-1 rounded border bg-transparent px-2 py-1.5"
          >
            <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
            Fix Command
          </button>
        </section>

        <section className="min-h-0 min-w-0 overflow-y-auto p-2">
          <label className="text-xs font-semibold" htmlFor="command-preview">
            Command preview
          </label>
          <textarea
            id="command-preview"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Enter or paste a command to classify"
            rows={3}
            className="border-input bg-input mt-1 box-border w-full resize-y rounded border p-2 font-mono text-xs outline-none"
          />
          <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
            <label className="text-description-muted text-2xs min-w-0">
              Base policy
              <select
                aria-label="Base policy"
                value={basePolicy}
                onChange={(event) =>
                  setBasePolicy(event.target.value as ToolPolicy)
                }
                className="border-input bg-input mt-1 block w-full min-w-0 rounded border px-2 py-1 text-xs"
              >
                <option value="allowedWithoutPermission">Autonomous</option>
                <option value="allowedWithPermission">Ask every time</option>
                <option value="disabled">Read only</option>
              </select>
            </label>
            <label className="border-input bg-input mt-4 flex min-w-0 items-center gap-2 rounded border px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={sandboxed}
                onChange={(event) => setSandboxed(event.target.checked)}
              />
              Sandbox
            </label>
          </div>

          {classification && (
            <div
              aria-label="Command security preview"
              className="border-input bg-input text-2xs mt-2 min-w-0 rounded border p-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span
                  className={`rounded px-1.5 py-0.5 font-semibold ${classification.policy === "disabled" ? "bg-error/15 text-error" : classification.policy === "allowedWithPermission" ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}
                >
                  {classification.policy === "allowedWithoutPermission"
                    ? "Allowed"
                    : classification.policy === "allowedWithPermission"
                      ? "Approval required"
                      : "Blocked"}
                </span>
                <span className="border-input rounded border px-1.5 py-0.5">
                  {classification.sandboxed ? "Sandboxed" : "Host"}
                </span>
                <span className="border-input rounded border px-1.5 py-0.5">
                  {classification.elevated ? "Elevated" : "Unelevated"}
                </span>
                {classification.requiresNetwork && (
                  <span className="border-input rounded border px-1.5 py-0.5">
                    Network
                  </span>
                )}
              </div>
              <ul className="text-description-muted mb-0 mt-2 list-inside list-disc break-words pl-0">
                {classification.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <div className="mt-2 min-w-0 overflow-x-auto font-mono">
                {classification.segments.map((segment, index) => (
                  <span key={`${segment.executable}-${index}`}>
                    <strong>{segment.executable}</strong>
                    {segment.args.length ? ` ${segment.args.join(" ")}` : ""}
                    {segment.operatorAfter ? ` ${segment.operatorAfter} ` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="border-error bg-error/10 text-error text-2xs mt-2 break-words rounded border p-2"
            >
              {error}
            </div>
          )}
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            <button
              disabled={
                !classification ||
                classification.policy === "disabled" ||
                running
              }
              onClick={() => void execute()}
              className="bg-button hover:bg-button-hover flex min-w-0 flex-1 items-center justify-center gap-1 rounded border-none px-2 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {running ? (
                <StopIcon className="h-3.5 w-3.5" />
              ) : (
                <PaperAirplaneIcon className="h-3.5 w-3.5" />
              )}
              {running ? "Running…" : "Accept and run"}
            </button>
            <button
              disabled={!classification || classification.policy === "disabled"}
              onClick={() => void startBackground()}
              className="border-input bg-input hover:bg-list-hover rounded border px-2 py-1.5 text-xs disabled:opacity-50"
            >
              Run in background
            </button>
            <button
              onClick={() => {
                setCommand("");
                setClassification(undefined);
                setError(undefined);
              }}
              className="border-input bg-input hover:bg-list-hover rounded border px-3 py-1.5 text-xs"
            >
              Reject
            </button>
          </div>
          {jobs.length > 0 && (
            <div className="border-input mt-3 border-t pt-2">
              <div className="mb-1 text-xs font-semibold">Background jobs</div>
              {jobs.slice(0, 8).map((job) => (
                <div
                  key={job.id}
                  className="border-input text-2xs flex min-w-0 items-center gap-2 border-b py-1"
                >
                  <button
                    onClick={async () => {
                      const response = await ideMessenger.request(
                        "terminal/jobOutput",
                        { jobId: job.id },
                      );
                      if (response.status === "success")
                        setTerminalOutput(response.content);
                    }}
                    className="min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left"
                  >
                    {job.command}
                  </button>
                  <span className="text-description-muted">{job.status}</span>
                  {job.status === "running" && (
                    <button
                      onClick={async () => {
                        await ideMessenger.request("terminal/jobStop", {
                          jobId: job.id,
                        });
                        await loadJobs();
                      }}
                      className="text-error border-none bg-transparent"
                    >
                      Stop
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default TerminalAssistant;
