import type {
  ReviewActionRequest,
  ReviewFindingComment,
  ReviewReport,
} from "@qivryn/review-engine";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftIcon,
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  PlayIcon,
  ShieldCheckIcon,
  StopIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch } from "../../redux/hooks";
import { setMainEditorContentTrigger } from "../../redux/slices/sessionSlice";
import { ROUTES } from "../../util/navigation";

type TargetType = ReviewReport["request"]["target"]["type"];

const targetLabels: Record<TargetType, string> = {
  "working-tree": "Working tree",
  staged: "Staged changes",
  commit: "Commit",
  branch: "Branch range",
  files: "Selected files",
  "pull-request": "Pull request",
};

const modeDescriptions: Record<ReviewReport["request"]["mode"], string> = {
  fast: "Local safety scan. Fast, deterministic, and model-free.",
  standard:
    "Local checks plus a semantic review with your selected chat model.",
  deep: "Expanded semantic analysis for larger or higher-risk changes.",
};

function severityClass(severity: string): string {
  if (severity === "error") return "bg-error/15 text-error border-error/30";
  if (severity === "warning")
    return "bg-warning/15 text-warning border-warning/30";
  return "bg-info/15 text-info border-info/30";
}

function statusClass(status: ReviewReport["status"]): string {
  if (status === "failed") return "bg-error";
  if (status === "completed") return "bg-success";
  if (status === "canceled") return "bg-description-muted";
  return "bg-warning";
}

function errorSummary(error: string | undefined): string {
  if (!error) return "The analyzer did not complete.";
  return error.split(/\nURL:|\nResponse:|\s+URL:\s+/)[0].trim();
}

function ReviewPage() {
  const ideMessenger = useContext(IdeMessengerContext);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [repositoryPath, setRepositoryPath] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("working-tree");
  const [targetValue, setTargetValue] = useState("");
  const [branchHead, setBranchHead] = useState("HEAD");
  const [mode, setMode] = useState<ReviewReport["request"]["mode"]>("standard");
  const [runningId, setRunningId] = useState<string>();
  const [error, setError] = useState<string>();
  const [comments, setComments] = useState<
    Record<string, ReviewFindingComment[]>
  >({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );

  const load = useCallback(async () => {
    const response = await ideMessenger.request("reviews/list", undefined);
    if (response.status === "error") return setError(response.error);
    setReports(response.content);
    setSelectedId(
      (current) =>
        current ??
        response.content.find(
          (report) => report.id === searchParams.get("reviewId"),
        )?.id ??
        response.content[0]?.id,
    );
  }, [ideMessenger, searchParams]);

  useEffect(() => {
    void load();
    void ideMessenger
      .request("getWorkspaceDirs", undefined)
      .then((response) => {
        if (response.status === "success" && response.content[0]) {
          setRepositoryPath(response.content[0].replace(/^file:\/\//, ""));
        }
      });
  }, [ideMessenger, load]);

  const selected = reports.find((report) => report.id === selectedId);
  const activeFindings = useMemo(
    () =>
      selected?.findings.filter((finding) => finding.status === "open") ?? [],
    [selected],
  );

  useEffect(() => {
    if (!selectedId) return;
    void ideMessenger
      .request("reviews/get", { reportId: selectedId })
      .then((response) => {
        if (response.status === "success" && response.content) {
          setReports((current) =>
            current.map((report) =>
              report.id === response.content!.id ? response.content! : report,
            ),
          );
        }
      });
  }, [ideMessenger, selectedId]);

  const makeTarget = (): ReviewReport["request"]["target"] => {
    switch (targetType) {
      case "commit":
        return { type: "commit", revision: targetValue.trim() || "HEAD" };
      case "branch":
        return {
          type: "branch",
          base: targetValue.trim() || "main",
          head: branchHead.trim() || "HEAD",
        };
      case "files":
        return {
          type: "files",
          paths: targetValue
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        };
      case "pull-request":
        return { type: "pull-request", url: targetValue.trim() };
      case "staged":
        return { type: "staged" };
      default:
        return { type: "working-tree" };
    }
  };

  const runReview = useCallback(
    async (source?: ReviewReport) => {
      const root = source?.repositoryPath ?? repositoryPath.trim();
      if (!root) return;
      const id = `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const request = {
        id,
        mode: source?.request.mode ?? mode,
        target: source?.request.target ?? makeTarget(),
      };
      const startedAt = new Date().toISOString();
      const pendingReport: ReviewReport = {
        id,
        repositoryPath: root,
        request,
        status: "running",
        createdAt: startedAt,
        updatedAt: startedAt,
        findings: [],
        analyzerIds: source?.analyzerIds ?? [],
        summary: "Review in progress",
        revision: 0,
      };

      setRunningId(id);
      setError(undefined);
      setReports((current) => [
        pendingReport,
        ...current.filter((item) => item.id !== id),
      ]);
      setSelectedId(id);

      const response = await ideMessenger.request("reviews/run", {
        repositoryPath: root,
        request,
      });
      setRunningId(undefined);
      if (response.status === "error") {
        setReports((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "failed",
                  updatedAt: new Date().toISOString(),
                  summary: undefined,
                  error: response.error,
                }
              : item,
          ),
        );
        return setError(response.error);
      }
      setReports((current) => [
        response.content,
        ...current.filter((item) => item.id !== response.content.id),
      ]);
    },
    [branchHead, ideMessenger, mode, repositoryPath, targetType, targetValue],
  );

  const action = useCallback(
    async (request: ReviewActionRequest) => {
      setError(undefined);
      const response = await ideMessenger.request("reviews/action", request);
      if (response.status === "error") return setError(response.error);
      await load();
    },
    [ideMessenger, load],
  );

  const loadComments = useCallback(
    async (findingId: string) => {
      const response = await ideMessenger.request("reviews/comments", {
        findingId,
      });
      if (response.status === "success") {
        setComments((current) => ({
          ...current,
          [findingId]: response.content,
        }));
      }
    },
    [ideMessenger],
  );

  const addToChat = (
    finding: NonNullable<typeof selected>["findings"][number],
  ) => {
    const paragraphs = [
      `Review finding in ${finding.filepath}:${finding.startLine}`,
      finding.title,
      finding.body,
      "Please investigate and fix this finding.",
    ];
    dispatch(
      setMainEditorContentTrigger({
        type: "doc",
        content: paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      }),
    );
    navigate(ROUTES.HOME);
  };

  return (
    <div className="bg-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="border-input flex h-12 flex-shrink-0 items-center gap-3 border-b px-3">
        <button
          aria-label="Back to chat"
          onClick={() => navigate(ROUTES.HOME)}
          className="hover:bg-list-hover flex h-8 w-8 items-center justify-center rounded-md border-none bg-transparent"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-sm font-semibold tracking-tight">
            Agent Review
          </h1>
          <p className="text-description-muted text-2xs m-0 truncate">
            Inspect changes before they ship
          </p>
        </div>
        <div className="border-input bg-input text-2xs flex items-center gap-1.5 rounded-full border px-2 py-1">
          <span className="bg-warning h-1.5 w-1.5 rounded-full" />
          {activeFindings.length} open
        </div>
        <button
          aria-label="Refresh reviews"
          onClick={() => void load()}
          className="hover:bg-list-hover flex h-8 w-8 items-center justify-center rounded-md border-none bg-transparent"
        >
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <section
          aria-label="Start review"
          className="border-input border-b p-3"
        >
          <div className="border-input bg-input/40 mx-auto max-w-5xl rounded-xl border p-3 shadow-sm">
            <div className="mb-3 flex items-start gap-2">
              <div className="bg-button/15 text-button flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg">
                <ShieldCheckIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-xs font-semibold">
                  Start a code review
                </h2>
                <p className="text-description-muted text-2xs m-0 mt-0.5">
                  Choose what to inspect and how deeply Qivryn should analyze
                  it.
                </p>
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-2 min-[720px]:grid-cols-[minmax(180px,1.4fr)_minmax(130px,.7fr)_minmax(150px,.8fr)_auto]">
              <label className="text-description-muted text-2xs col-span-2 min-w-0 min-[720px]:col-span-1">
                Repository
                <input
                  aria-label="Repository path"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  placeholder="Repository path"
                  className="border-input bg-editor mt-1 box-border h-9 w-full min-w-0 rounded-md border px-2.5 text-xs outline-none focus:border-current"
                />
              </label>
              <label className="text-description-muted text-2xs min-w-0">
                Changes
                <select
                  aria-label="Review target"
                  value={targetType}
                  onChange={(event) =>
                    setTargetType(event.target.value as TargetType)
                  }
                  className="border-input bg-editor mt-1 h-9 w-full min-w-0 rounded-md border px-2 text-xs"
                >
                  {Object.entries(targetLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-description-muted text-2xs min-w-0">
                Depth
                <select
                  aria-label="Review depth"
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as typeof mode)
                  }
                  className="border-input bg-editor mt-1 h-9 w-full min-w-0 rounded-md border px-2 text-xs"
                >
                  <option value="fast">Fast</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep</option>
                </select>
              </label>
              <div className="col-span-2 flex items-end gap-2 min-[720px]:col-span-1">
                <button
                  aria-label="Run review"
                  disabled={Boolean(runningId) || !repositoryPath.trim()}
                  onClick={() => void runReview()}
                  className="bg-button hover:bg-button-hover flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border-none px-4 text-xs font-medium text-white disabled:opacity-50"
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                  {runningId ? "Reviewing…" : "Run review"}
                </button>
                {runningId && (
                  <button
                    aria-label="Cancel review"
                    onClick={() =>
                      void ideMessenger.request("reviews/cancel", {
                        reportId: runningId,
                      })
                    }
                    className="border-input bg-editor flex h-9 items-center justify-center gap-1 rounded-md border px-2 text-xs"
                  >
                    <StopIcon className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {!["working-tree", "staged"].includes(targetType) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  aria-label="Target value"
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  placeholder={
                    targetType === "files"
                      ? "src/a.ts, src/b.ts"
                      : targetType === "pull-request"
                        ? "Pull request URL"
                        : targetType === "branch"
                          ? "Base branch"
                          : "Commit SHA"
                  }
                  className="border-input bg-editor col-span-2 h-9 min-w-0 rounded-md border px-2.5 text-xs outline-none"
                />
                {targetType === "branch" && (
                  <input
                    aria-label="Head branch"
                    value={branchHead}
                    onChange={(event) => setBranchHead(event.target.value)}
                    placeholder="Head branch"
                    className="border-input bg-editor col-span-2 h-9 min-w-0 rounded-md border px-2.5 text-xs outline-none"
                  />
                )}
              </div>
            )}
            <p className="text-description-muted text-2xs m-0 mt-2 flex items-center gap-1.5">
              <span className="bg-button h-1 w-1 rounded-full" />
              {modeDescriptions[mode]}
            </p>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="border-error bg-error/10 text-error mx-3 mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs"
          >
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              {errorSummary(error)}
            </span>
            <button
              aria-label="Dismiss error"
              onClick={() => setError(undefined)}
              className="border-none bg-transparent p-0"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="mx-auto grid min-h-0 max-w-5xl grid-cols-1 gap-3 p-3 min-[760px]:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="min-w-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="m-0 text-xs font-semibold">Recent runs</h2>
              <span className="text-description-muted text-2xs">
                {reports.length}
              </span>
            </div>
            <nav
              aria-label="Review reports"
              className="flex max-h-48 flex-col gap-1.5 overflow-y-auto min-[760px]:max-h-[calc(100vh-250px)]"
            >
              {reports.length === 0 && (
                <div className="border-input text-description-muted rounded-lg border border-dashed p-5 text-center text-xs">
                  Your review history will appear here.
                </div>
              )}
              {reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => setSelectedId(report.id)}
                  className={`border-input relative box-border w-full min-w-0 overflow-hidden rounded-lg border p-2.5 text-left transition-colors ${report.id === selectedId ? "bg-list-active" : "hover:bg-list-hover bg-transparent"}`}
                >
                  <span
                    className={`absolute bottom-0 left-0 top-0 w-0.5 ${statusClass(report.status)}`}
                  />
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {targetLabels[report.request.target.type]}
                    </span>
                    <span className="border-input bg-editor text-2xs rounded-full border px-1.5 py-0.5">
                      {report.findings.length}
                    </span>
                  </div>
                  <div className="text-description-muted text-2xs mt-1.5 flex items-center gap-1.5">
                    <span className="capitalize">{report.request.mode}</span>
                    <span>·</span>
                    <span className="capitalize">{report.status}</span>
                    <ClockIcon className="ml-auto h-3 w-3" />
                    <span>
                      {new Date(report.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </button>
              ))}
            </nav>
          </aside>

          <main className="min-h-0 min-w-0">
            {!selected && (
              <div className="border-input text-description-muted flex min-h-48 items-center justify-center rounded-xl border border-dashed p-6 text-center text-xs">
                Select a review or start a new one.
              </div>
            )}
            {selected && (
              <div className="flex min-w-0 flex-col gap-3">
                <section className="border-input bg-input/30 rounded-xl border p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${statusClass(selected.status)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 className="m-0 truncate text-sm font-semibold">
                          {selected.summary ??
                            targetLabels[selected.request.target.type]}
                        </h2>
                        <span className="border-input text-description-muted text-2xs rounded-full border px-2 py-0.5 capitalize">
                          {selected.status}
                        </span>
                      </div>
                      <p className="text-description-muted text-2xs m-0 mt-1 truncate">
                        {selected.repositoryPath}
                      </p>
                    </div>
                    <button
                      aria-label="Rerun review"
                      title="Rerun review"
                      onClick={() => void runReview(selected)}
                      className="border-input hover:bg-list-hover flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border bg-transparent"
                    >
                      <ArrowPathIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="border-input mt-3 grid grid-cols-3 divide-x rounded-lg border">
                    <div className="p-2 text-center">
                      <div className="text-sm font-semibold">
                        {activeFindings.length}
                      </div>
                      <div className="text-description-muted text-2xs">
                        Open
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-sm font-semibold">
                        {selected.findings.length}
                      </div>
                      <div className="text-description-muted text-2xs">
                        Total
                      </div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-sm font-semibold capitalize">
                        {selected.request.mode}
                      </div>
                      <div className="text-description-muted text-2xs">
                        Depth
                      </div>
                    </div>
                  </div>
                </section>

                {selected.status === "failed" && (
                  <div
                    role="alert"
                    className="border-error bg-error/10 rounded-xl border p-4 text-xs"
                  >
                    <div className="text-error flex items-center gap-2 font-semibold">
                      <ExclamationTriangleIcon className="h-4 w-4" />
                      Review failed
                    </div>
                    <p className="text-error m-0 mt-2 break-words leading-relaxed">
                      {errorSummary(selected.error)}
                    </p>
                    <p className="text-description-muted text-2xs m-0 mt-2">
                      Historical result from{" "}
                      {new Date(selected.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      . Rerun to test the current configuration.
                    </p>
                    {selected.error &&
                      selected.error !== errorSummary(selected.error) && (
                        <details className="border-error/30 mt-3 border-t pt-2">
                          <summary className="text-description-muted text-2xs cursor-pointer">
                            Technical details
                          </summary>
                          <pre className="text-description-muted text-2xs mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                            {selected.error}
                          </pre>
                        </details>
                      )}
                  </div>
                )}

                {selected.status === "completed" &&
                  selected.findings.length === 0 && (
                    <div className="border-success/30 bg-success/10 rounded-xl border p-6 text-center text-xs">
                      <CheckIcon className="text-success mx-auto mb-2 h-6 w-6" />
                      <div className="font-semibold">
                        No findings for this change set.
                      </div>
                      <p className="text-description-muted text-2xs m-0 mt-1">
                        Qivryn completed the selected checks without identifying
                        an actionable issue.
                      </p>
                    </div>
                  )}

                {["queued", "running"].includes(selected.status) && (
                  <div
                    role="status"
                    className="border-input bg-input rounded-xl border p-6 text-center text-xs"
                  >
                    <ArrowPathIcon className="text-button mx-auto mb-2 h-5 w-5 animate-spin" />
                    Review in progress…
                  </div>
                )}

                <div className="flex min-w-0 flex-col gap-2">
                  {selected.findings.map((finding) => (
                    <article
                      key={finding.id}
                      className={`border-input bg-input/40 min-w-0 rounded-xl border p-3 ${finding.status !== "open" ? "opacity-60" : ""}`}
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className={`text-2xs rounded-md border px-1.5 py-0.5 font-medium uppercase ${severityClass(finding.severity)}`}
                        >
                          {finding.severity}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="m-0 break-words text-xs font-semibold">
                            {finding.title}
                          </h3>
                          <button
                            onClick={() =>
                              void ideMessenger.ide.openFile(
                                `${selected.repositoryPath}/${finding.filepath}`,
                              )
                            }
                            className="text-description-muted hover:text-foreground text-2xs mt-1 max-w-full truncate border-none bg-transparent p-0 text-left"
                          >
                            {finding.filepath}:{finding.startLine}
                            {finding.endLine ? `–${finding.endLine}` : ""}
                          </button>
                        </div>
                        <span className="text-description-muted text-2xs flex-shrink-0 capitalize">
                          {finding.status}
                        </span>
                      </div>
                      <p className="my-3 break-words text-xs leading-relaxed">
                        {finding.body}
                      </p>
                      {finding.evidence && (
                        <pre className="border-input bg-editor text-2xs m-0 max-w-full overflow-x-auto rounded-lg border p-2.5">
                          <code>{finding.evidence}</code>
                        </pre>
                      )}
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
                        {finding.proposedPatch && (
                          <button
                            onClick={() =>
                              void action({
                                action: "fix",
                                reportId: selected.id,
                                findingId: finding.id,
                              })
                            }
                            className="bg-button text-2xs flex items-center gap-1 rounded-md border-none px-2.5 py-1.5 text-white"
                          >
                            <WrenchScrewdriverIcon className="h-3 w-3" />
                            Fix
                          </button>
                        )}
                        <button
                          onClick={() => addToChat(finding)}
                          className="border-input hover:bg-list-hover text-2xs flex items-center gap-1 rounded-md border bg-transparent px-2.5 py-1.5"
                        >
                          <ChatBubbleLeftIcon className="h-3 w-3" />
                          Add to Chat
                        </button>
                        <button
                          aria-label={
                            finding.status === "dismissed"
                              ? "Reopen"
                              : "Dismiss"
                          }
                          onClick={() =>
                            void action({
                              action: "status",
                              reportId: selected.id,
                              findingId: finding.id,
                              status:
                                finding.status === "dismissed"
                                  ? "open"
                                  : "dismissed",
                            })
                          }
                          className="border-input hover:bg-list-hover text-2xs rounded-md border bg-transparent px-2.5 py-1.5"
                        >
                          {finding.status === "dismissed"
                            ? "Reopen"
                            : "Dismiss"}
                        </button>
                        <button
                          aria-label="Helpful finding"
                          onClick={() =>
                            void action({
                              action: "feedback",
                              findingId: finding.id,
                              value: "up",
                            })
                          }
                          className="hover:bg-list-hover ml-auto flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
                        >
                          <HandThumbUpIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Unhelpful finding"
                          onClick={() =>
                            void action({
                              action: "feedback",
                              findingId: finding.id,
                              value: "down",
                            })
                          }
                          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent"
                        >
                          <HandThumbDownIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex min-w-0 gap-1.5">
                        <input
                          aria-label={`Reply to ${finding.title}`}
                          value={commentDrafts[finding.id] ?? ""}
                          onFocus={() => void loadComments(finding.id)}
                          onChange={(event) =>
                            setCommentDrafts((current) => ({
                              ...current,
                              [finding.id]: event.target.value,
                            }))
                          }
                          placeholder="Reply to finding…"
                          className="border-input bg-editor text-2xs h-8 min-w-0 flex-1 rounded-md border px-2 outline-none"
                        />
                        <button
                          disabled={!commentDrafts[finding.id]?.trim()}
                          onClick={async () => {
                            await action({
                              action: "comment",
                              findingId: finding.id,
                              body: commentDrafts[finding.id],
                            });
                            setCommentDrafts((current) => ({
                              ...current,
                              [finding.id]: "",
                            }));
                            await loadComments(finding.id);
                          }}
                          className="bg-button text-2xs rounded-md border-none px-2.5 text-white disabled:opacity-50"
                        >
                          Reply
                        </button>
                      </div>
                      {(comments[finding.id]?.length ?? 0) > 0 && (
                        <div className="border-input mt-2 space-y-1 border-l-2 pl-2">
                          {comments[finding.id].map((comment) => (
                            <div
                              key={comment.id}
                              className="text-description-muted text-2xs break-words"
                            >
                              {comment.author}: {comment.body}
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default ReviewPage;
