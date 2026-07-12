import type { AgentRun } from "@qivryn/agent-runtime";
import { AGENT_ACTIVE_RUN_STATUSES } from "@qivryn/agent-runtime/presentation";
import { ArrowPathIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { ROUTES } from "../../util/navigation";

interface AgentsListProps {
  isCreatingAgent?: boolean;
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function AgentsList({ isCreatingAgent = false }: AgentsListProps) {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const response = await ideMessenger.request("agents/list", {
      includeArchived: false,
      limit: 20,
    });
    if (response.status === "error") setError(response.error);
    else {
      setError(undefined);
      setRuns(response.content);
    }
  }, [ideMessenger]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [load]);

  const ordered = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const activeDifference =
          Number(AGENT_ACTIVE_RUN_STATUSES.has(b.status)) -
          Number(AGENT_ACTIVE_RUN_STATUSES.has(a.status));
        return (
          activeDifference ||
          Date.parse(b.updatedAt ?? b.createdAt) -
            Date.parse(a.updatedAt ?? a.createdAt)
        );
      }),
    [runs],
  );

  if (error) {
    return (
      <div role="alert" className="text-error px-2 py-3 text-xs">
        {error}
      </div>
    );
  }

  if (ordered.length === 0 && !isCreatingAgent) {
    return (
      <div className="text-description-muted px-2 py-4 text-center text-xs">
        No agent runs yet.
      </div>
    );
  }

  return (
    <div aria-label="Background agents" className="space-y-1 px-1">
      {isCreatingAgent && (
        <div className="text-description flex h-9 items-center gap-2 px-2 text-xs">
          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
          <span>Starting agent</span>
        </div>
      )}
      {ordered.map((run) => {
        const active = AGENT_ACTIVE_RUN_STATUSES.has(run.status);
        return (
          <button
            key={run.id}
            type="button"
            onClick={() =>
              navigate(`${ROUTES.AGENTS}?runId=${encodeURIComponent(run.id)}`)
            }
            className="hover:bg-list-hover grid h-11 w-full grid-cols-[16px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border-none bg-transparent px-2 text-left"
          >
            {active ? (
              <ArrowPathIcon className="text-link h-3.5 w-3.5 animate-spin" />
            ) : (
              <span className="bg-description-muted mx-auto h-1.5 w-1.5 rounded-full" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">
                {run.title}
              </span>
              <span className="text-description block truncate text-[10px] capitalize">
                {run.status.replaceAll("_", " ")}
                {run.parentRunId ? " · subagent" : ""}
              </span>
            </span>
            <span className="text-description-muted text-[10px]">
              {relativeTime(run.updatedAt ?? run.createdAt)}
            </span>
            <ChevronRightIcon className="text-description-muted h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}
