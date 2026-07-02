import type {
  ReviewActionRequest,
  ReviewFindingComment,
  ReviewReport,
} from "@continuedev/review-engine";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftIcon,
  CheckIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  PlayIcon,
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

function badge(severity: string): string {
  if (severity === "error") return "bg-error/15 text-error";
  if (severity === "warning") return "bg-warning/15 text-warning";
  return "bg-info/15 text-info";
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
  const activeFindings = useMemo(
    () =>
      selected?.findings.filter((finding) => finding.status === "open") ?? [],
    [selected],
  );

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
      setRunningId(id);
      setError(undefined);
      const response = await ideMessenger.request("reviews/run", {
        repositoryPath: root,
        request: {
          id,
          mode: source?.request.mode ?? mode,
          target: source?.request.target ?? makeTarget(),
        },
      });
      setRunningId(undefined);
      if (response.status === "error") return setError(response.error);
      setReports((current) => [
        response.content,
        ...current.filter((item) => item.id !== response.content.id),
      ]);
      setSelectedId(response.content.id);
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
      <header className="border-input flex h-10 flex-shrink-0 items-center gap-2 border-b px-2">
        <button
          aria-label="Back to chat"
          onClick={() => navigate(ROUTES.HOME)}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
          Agent Review
        </h1>
        <span className="text-description-muted text-2xs">
          {activeFindings.length} open
        </span>
        <button
          aria-label="Refresh reviews"
          onClick={() => void load()}
          className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
        >
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </header>

      <section
        aria-label="Start review"
        className="border-input grid min-w-0 flex-shrink-0 grid-cols-2 gap-2 border-b p-2 min-[520px]:grid-cols-4"
      >
        <input
          aria-label="Repository path"
          value={repositoryPath}
          onChange={(event) => setRepositoryPath(event.target.value)}
          placeholder="Repository path"
          className="border-input bg-input col-span-2 min-w-0 rounded border px-2 py-1.5 text-xs outline-none min-[520px]:col-span-4"
        />
        <select
          aria-label="Review target"
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as TargetType)}
          className="border-input bg-input min-w-0 rounded border px-2 py-1.5 text-xs"
        >
          {Object.entries(targetLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Review depth"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
          className="border-input bg-input min-w-0 rounded border px-2 py-1.5 text-xs"
        >
          <option value="fast">Fast · deterministic</option>
          <option value="standard">Standard · semantic</option>
          <option value="deep">Deep · semantic</option>
        </select>
        <div className="text-description-muted text-2xs col-span-2 min-[520px]:col-span-4">
          {mode === "fast"
            ? "Fast runs local safety checks without a model."
            : mode === "deep"
              ? "Deep gives the selected chat model a larger diff budget, then validates every finding against changed lines."
              : "Standard combines local safety checks with the selected chat model and validates every finding against changed lines."}
        </div>
        {!["working-tree", "staged"].includes(targetType) && (
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
            className="border-input bg-input col-span-2 min-w-0 rounded border px-2 py-1.5 text-xs outline-none"
          />
        )}
        {targetType === "branch" && (
          <input
            aria-label="Head branch"
            value={branchHead}
            onChange={(event) => setBranchHead(event.target.value)}
            placeholder="Head branch"
            className="border-input bg-input col-span-2 min-w-0 rounded border px-2 py-1.5 text-xs outline-none"
          />
        )}
        <button
          disabled={Boolean(runningId) || !repositoryPath.trim()}
          onClick={() => void runReview()}
          className="bg-button hover:bg-button-hover col-span-2 flex min-w-0 items-center justify-center gap-1 rounded border-none px-2 py-1.5 text-xs text-white disabled:opacity-50 min-[520px]:col-span-1"
        >
          <PlayIcon className="h-3.5 w-3.5" />{" "}
          {runningId ? "Reviewing…" : "Run review"}
        </button>
        {runningId && (
          <button
            onClick={() =>
              void ideMessenger.request("reviews/cancel", {
                reportId: runningId,
              })
            }
            className="border-input bg-input flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-xs"
          >
            <StopIcon className="h-3.5 w-3.5" />
            Cancel
          </button>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="border-error bg-error/10 text-error mx-2 mt-2 flex items-start gap-2 rounded border p-2 text-xs"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            aria-label="Dismiss error"
            onClick={() => setError(undefined)}
            className="border-none bg-transparent"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden min-[680px]:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Review reports"
          className="border-input max-h-36 min-w-0 overflow-y-auto border-b p-1 min-[680px]:max-h-none min-[680px]:border-b-0 min-[680px]:border-r"
        >
          {reports.length === 0 && (
            <div className="text-description-muted p-3 text-center text-xs">
              Run a review to inspect local changes.
            </div>
          )}
          {reports.map((report) => (
            <button
              key={report.id}
              onClick={() => setSelectedId(report.id)}
              className={`mb-1 box-border w-full min-w-0 rounded border-none p-2 text-left ${report.id === selectedId ? "bg-list-active" : "hover:bg-list-hover bg-transparent"}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {targetLabels[report.request.target.type]}
                </span>
                <span className="text-description-muted text-2xs">
                  {report.findings.length}
                </span>
              </div>
              <div className="text-description-muted text-2xs mt-1 flex min-w-0 gap-2">
                <span className="truncate">{report.request.mode}</span>
                <span className="ml-auto flex-shrink-0">
                  {new Date(report.updatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>
          ))}
        </nav>

        <main className="min-h-0 min-w-0 overflow-y-auto p-2">
          {selected && (
            <>
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-xs font-semibold">
                  {selected.summary ?? selected.status}
                </span>
                <span className="text-description-muted text-2xs truncate">
                  {selected.repositoryPath}
                </span>
                <button
                  aria-label="Rerun review"
                  title="Rerun review"
                  onClick={() => void runReview(selected)}
                  className="hover:bg-list-hover ml-auto flex h-6 w-6 items-center justify-center rounded border-none bg-transparent"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {selected.status === "failed" && (
                <div
                  role="alert"
                  className="border-error bg-error/10 text-error rounded border p-4 text-xs"
                >
                  <div className="font-semibold">Review failed</div>
                  <div className="mt-1 break-words">
                    {selected.error ?? "The analyzer did not complete."}
                  </div>
                </div>
              )}
              {selected.status === "completed" &&
                selected.findings.length === 0 && (
                  <div className="border-input bg-input rounded border p-5 text-center text-xs">
                    <CheckIcon className="text-success mx-auto mb-2 h-5 w-5" />
                    No findings for this change set.
                  </div>
                )}
              {["queued", "running"].includes(selected.status) && (
                <div
                  role="status"
                  className="border-input bg-input rounded border p-5 text-center text-xs"
                >
                  Review in progress…
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-2">
                {selected.findings.map((finding) => (
                  <article
                    key={finding.id}
                    className={`border-input bg-input min-w-0 rounded-lg border p-2 ${finding.status !== "open" ? "opacity-60" : ""}`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className={`text-2xs rounded px-1.5 py-0.5 uppercase ${badge(finding.severity)}`}
                      >
                        {finding.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="m-0 break-words text-xs font-semibold">
                          {finding.title}
                        </h2>
                        <button
                          onClick={() =>
                            void ideMessenger.ide.openFile(
                              `${selected.repositoryPath}/${finding.filepath}`,
                            )
                          }
                          className="text-description-muted hover:text-foreground text-2xs mt-0.5 max-w-full truncate border-none bg-transparent p-0 text-left"
                        >
                          {finding.filepath}:{finding.startLine}
                          {finding.endLine ? `–${finding.endLine}` : ""}
                        </button>
                      </div>
                      <span className="text-description-muted text-2xs flex-shrink-0">
                        {finding.status}
                      </span>
                    </div>
                    <p className="my-2 break-words text-xs leading-relaxed">
                      {finding.body}
                    </p>
                    {finding.evidence && (
                      <pre className="border-input bg-editor text-2xs m-0 max-w-full overflow-x-auto rounded border p-2">
                        <code>{finding.evidence}</code>
                      </pre>
                    )}
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                      {finding.proposedPatch && (
                        <button
                          onClick={() =>
                            void action({
                              action: "fix",
                              reportId: selected.id,
                              findingId: finding.id,
                            })
                          }
                          className="border-input hover:bg-list-hover text-2xs flex items-center gap-1 rounded border bg-transparent px-2 py-1"
                        >
                          <WrenchScrewdriverIcon className="h-3 w-3" />
                          Fix
                        </button>
                      )}
                      <button
                        onClick={() => addToChat(finding)}
                        className="border-input hover:bg-list-hover text-2xs flex items-center gap-1 rounded border bg-transparent px-2 py-1"
                      >
                        <ChatBubbleLeftIcon className="h-3 w-3" />
                        Add to Chat
                      </button>
                      <button
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
                        className="border-input hover:bg-list-hover text-2xs rounded border bg-transparent px-2 py-1"
                      >
                        {finding.status === "dismissed" ? "Reopen" : "Dismiss"}
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
                        className="hover:bg-list-hover ml-auto flex h-6 w-6 items-center justify-center rounded border-none bg-transparent"
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
                        className="hover:bg-list-hover flex h-6 w-6 items-center justify-center rounded border-none bg-transparent"
                      >
                        <HandThumbDownIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex min-w-0 gap-1">
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
                        className="border-input bg-editor text-2xs min-w-0 flex-1 rounded border px-2 py-1 outline-none"
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
                        className="bg-button text-2xs rounded border-none px-2 py-1 text-white disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                    {(comments[finding.id]?.length ?? 0) > 0 && (
                      <div className="mt-1 space-y-1">
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default ReviewPage;
