import { BaseSessionMetadata } from "core";
import MiniSearch from "minisearch";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import Shortcut from "../gui/Shortcut";

import { EllipsisHorizontalIcon, TrashIcon } from "@heroicons/react/24/outline";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  selectRunningSessionIdsValue,
  selectRunningSessionSummaries,
} from "../../redux/selectors/selectRunningSessions";
import {
  newSession,
  setAllSessionMetadata,
} from "../../redux/slices/sessionSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { refreshSessionMetadata } from "../../redux/thunks/session";
import { getFontSize, getPlatform } from "../../util";
import { ROUTES } from "../../util/navigation";
import ConfirmationDialog from "../dialogs/ConfirmationDialog";
import { Button } from "../ui";
import { HistoryTableRow } from "./HistoryTableRow";
import { getSessionActivityTime, groupSessionsByDate } from "./util";

const loadingPreviewGroups = [
  { label: "TODAY", rows: [82, 66, 74, 58] },
  { label: "YESTERDAY", rows: [72, 88, 64] },
  { label: "EARLIER", rows: [76, 61, 84] },
];

function HistoryLoadingPreview() {
  return (
    <div
      className="qivryn-history-loading-preview"
      role="status"
      aria-label="Loading sessions"
    >
      {loadingPreviewGroups.map((group) => (
        <section key={group.label} aria-hidden="true">
          <div className="qivryn-history-preview-label">{group.label}</div>
          {group.rows.map((width, index) => (
            <div className="qivryn-history-preview-row" key={index}>
              <span style={{ width: `${width}%` }} />
              <span style={{ width: `${Math.max(36, width - 24)}%` }} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function History() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);

  const [searchTerm, setSearchTerm] = useState("");
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const runningActivityTimesRef = useRef(new Map<string, number>());

  const minisearch = useRef<MiniSearch>(
    new MiniSearch({
      fields: ["title"],
      storeFields: ["title", "sessionId", "id"],
    }),
  ).current;

  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );
  const isSessionMetadataLoading = useAppSelector(
    (state) => state.session.isSessionMetadataLoading,
  );
  const runningSessionSummaries = useAppSelector(selectRunningSessionSummaries);
  const runningSessionIdsValue = useAppSelector(selectRunningSessionIdsValue);
  const runningSessionIds = useMemo(
    () =>
      new Set(
        runningSessionIdsValue ? runningSessionIdsValue.split("\u0000") : [],
      ),
    [runningSessionIdsValue],
  );

  const runningActivityTimes = useMemo(() => {
    const activityTimes = runningActivityTimesRef.current;
    for (const sessionId of activityTimes.keys()) {
      if (!runningSessionIds.has(sessionId)) {
        activityTimes.delete(sessionId);
      }
    }
    for (const session of runningSessionSummaries) {
      if (!activityTimes.has(session.sessionId)) {
        activityTimes.set(session.sessionId, Date.now());
      }
    }
    return activityTimes;
  }, [runningSessionIds, runningSessionSummaries]);

  const sessionMetadata = useMemo(() => {
    const merged = new Map(
      allSessionMetadata.map((session) => [session.sessionId, session]),
    );

    for (const runtime of runningSessionSummaries) {
      const existing = merged.get(runtime.sessionId);
      const runningActivityTime =
        runningActivityTimes.get(runtime.sessionId) ?? Date.now();
      if (existing) {
        merged.set(runtime.sessionId, {
          ...existing,
          title: runtime.title || existing.title,
          dateUpdated: String(
            Math.max(getSessionActivityTime(existing), runningActivityTime),
          ),
          messageCount: Math.max(
            existing.messageCount ?? 0,
            runtime.messageCount,
          ),
        });
      } else {
        const activityTime = String(runningActivityTime);
        merged.set(runtime.sessionId, {
          sessionId: runtime.sessionId,
          title: runtime.title,
          dateCreated: activityTime,
          dateUpdated: activityTime,
          workspaceDirectory: window.workspacePaths?.[0] || "",
          messageCount: runtime.messageCount,
        });
      }
    }

    return Array.from(merged.values());
  }, [allSessionMetadata, runningActivityTimes, runningSessionSummaries]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setRelativeTimeNow(Date.now()),
      60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      minisearch.removeAll();
      minisearch.addAll(
        sessionMetadata.map((session) => ({
          title: session.title,
          sessionId: session.sessionId,
          id: session.sessionId,
        })),
      );
    } catch (e) {
      console.log("error adding sessions to minisearch", e);
    }
  }, [sessionMetadata]);

  const platform = useMemo(() => getPlatform(), []);

  const filteredAndSortedSessions: BaseSessionMetadata[] = useMemo(() => {
    // 1. Exact phrase matching
    const exactResults = minisearch.search(searchTerm, {
      fuzzy: false,
    });

    // 2. Fuzzy matching with higher tolerance
    const fuzzyResults = minisearch.search(searchTerm, {
      fuzzy: 0.3,
    });

    // 3. Prefix matching for partial words
    const prefixResults = minisearch.search(searchTerm, {
      prefix: true,
      fuzzy: 0.2,
    });

    // Combine results, with exact matches having higher priority
    const allResults = [
      ...exactResults.map((r) => ({ ...r, priority: 3 })),
      ...fuzzyResults.map((r) => ({ ...r, priority: 2 })),
      ...prefixResults.map((r) => ({ ...r, priority: 1 })),
    ];

    // Remove duplicates while preserving highest priority
    const uniqueResultsMap = new Map<string, any>();
    allResults.forEach((result) => {
      const existing = uniqueResultsMap.get(result.id);
      if (!existing || existing.priority < result.priority) {
        uniqueResultsMap.set(result.id, result);
      }
    });
    const uniqueResults = Array.from(uniqueResultsMap.values());

    const sessionIds = uniqueResults
      .sort((a, b) => b.priority - a.priority || b.score - a.score)
      .map((result) => result.id);

    return sessionMetadata
      .filter((session) => {
        return searchTerm === "" || sessionIds.includes(session.sessionId);
      })
      .sort((a, b) => {
        const runningOrder =
          Number(runningSessionIds.has(b.sessionId)) -
          Number(runningSessionIds.has(a.sessionId));
        return (
          runningOrder || getSessionActivityTime(b) - getSessionActivityTime(a)
        );
      });
  }, [sessionMetadata, searchTerm, minisearch, runningSessionIds]);

  const sessionGroups = useMemo(() => {
    return groupSessionsByDate(
      filteredAndSortedSessions,
      runningSessionIds,
      relativeTimeNow,
    );
  }, [filteredAndSortedSessions, relativeTimeNow, runningSessionIds]);

  const showClearSessionsDialog = () => {
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title={`Clear sessions`}
          text={`Are you sure you want to permanently delete all chat sessions, including the current chat session?`}
          onConfirm={async () => {
            // optimistic update
            dispatch(setAllSessionMetadata([]));

            // actual update + refresh
            await ideMessenger.request("history/clear", undefined);
            void dispatch(refreshSessionMetadata({}));

            // start a new session
            dispatch(newSession());
            navigate(ROUTES.HOME);
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  return (
    <div
      style={{ fontSize: getFontSize() }}
      className="qivryn-history-panel flex flex-1 flex-col overflow-auto overflow-x-hidden px-1"
    >
      <div className="qivryn-history-header">
        <div className="qivryn-history-brand">
          <span className="qivryn-history-brand-mark" aria-hidden="true" />
          <span>Qivryn</span>
        </div>
        <div className="qivryn-history-actions">
          <button
            type="button"
            aria-label="Clear history"
            onClick={showClearSessionsDialog}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Clear search"
            disabled={!searchTerm}
            onClick={() => {
              setSearchTerm("");
              searchInputRef.current?.focus();
            }}
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="qivryn-history-search relative my-2 flex justify-center space-x-2">
        <MagnifyingGlassIcon
          className="qivryn-history-search-icon"
          aria-hidden="true"
        />
        <input
          className="bg-vsc-input-background text-vsc-foreground flex-1 rounded-md border border-none py-1 pl-8 pr-14 text-sm outline-none focus:outline-none"
          ref={searchInputRef}
          aria-label="Search sessions"
          placeholder="Search sessions"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {!searchTerm && (
          <span className="qivryn-history-search-shortcut" aria-hidden="true">
            {platform === "mac" ? "⌘K" : "Ctrl K"}
          </span>
        )}
        {searchTerm && (
          <XMarkIcon
            className="text-vsc-foreground hover:bg-vsc-background duration-50 absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 transform cursor-pointer rounded-full p-0.5 transition-colors"
            onClick={() => {
              setSearchTerm("");
              if (searchInputRef.current) {
                searchInputRef.current.focus();
              }
            }}
          />
        )}
      </div>

      <div className="thin-scrollbar flex w-full flex-1 flex-col overflow-y-auto">
        {filteredAndSortedSessions.length === 0 &&
          (isSessionMetadataLoading ? (
            <HistoryLoadingPreview />
          ) : (
            <div className="qivryn-history-empty m-3 text-center">
              No past sessions found. Start a new session with{" "}
              <Shortcut>meta L</Shortcut>.
            </div>
          ))}

        <div
          className="qivryn-history-table flex w-full flex-1 flex-col"
          role="list"
          aria-label="Chat sessions"
        >
          {sessionGroups.map((group, groupIndex) => {
            const headingId = `qivryn-history-${group.label.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              <section
                className="qivryn-history-group"
                aria-labelledby={headingId}
                key={group.label}
              >
                <h2
                  id={headingId}
                  className={`qivryn-history-group-label user-select-none ${
                    groupIndex === 0 ? "mt-2" : "mt-8"
                  }`}
                >
                  {group.label}
                </h2>
                {group.sessions.map((session, sessionIndex) => (
                  <HistoryTableRow
                    key={session.sessionId}
                    sessionMetadata={session}
                    index={groupIndex * 1000 + sessionIndex}
                    isRunning={runningSessionIds.has(session.sessionId)}
                    now={relativeTimeNow}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </div>

      <div className="qivryn-history-footer border-border flex flex-col items-end justify-center border-0 border-t border-solid px-2 py-3 text-xs">
        <Button variant="secondary" size="sm" onClick={showClearSessionsDialog}>
          <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Clear history</span>
        </Button>
        <span
          className="text-description text-2xs"
          data-testid="history-sessions-note"
        >
          Chat history is saved to{" "}
          <span className="italic">
            {platform === "windows"
              ? "%USERPROFILE%/.qivryn"
              : "~/.qivryn/sessions"}
          </span>
        </span>
      </div>
    </div>
  );
}
