import {
  ArrowDownOnSquareIcon,
  ChatBubbleLeftEllipsisIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { BaseSessionMetadata } from "core";
import { getUriPathBasename } from "core/util/uri";
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "..";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { exitEdit } from "../../redux/thunks/edit";
import {
  deleteSession,
  getSession,
  loadSession,
  updateSession,
} from "../../redux/thunks/session";
import { isShareSessionSupported } from "../../util";
import HeaderButtonWithToolTip from "../gui/HeaderButtonWithToolTip";
import { SessionRunningIndicator } from "../SessionRunningIndicator";
import { formatCompactRelativeTime, getSessionActivityDate } from "./util";

const shareSessionSupported = isShareSessionSupported();

export function HistoryTableRow({
  sessionMetadata,
  index,
  isRunning = false,
  now = Date.now(),
}: {
  sessionMetadata: BaseSessionMetadata;
  index: number;
  isRunning?: boolean;
  now?: number;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const ideMessenger = useContext(IdeMessengerContext);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sessionTitleEditValue, setSessionTitleEditValue] = useState(
    sessionMetadata.title,
  );
  const currentSessionId = useAppSelector((state) => state.session.id);
  const currentHistoryLength = useAppSelector(
    (state) => state.session.history.length,
  );
  const isCurrentSession = sessionMetadata.sessionId === currentSessionId;
  const shouldRehydratePersistedSession =
    isCurrentSession &&
    currentHistoryLength === 0 &&
    (sessionMetadata.messageCount ?? 0) > 0;
  const activityDate = getSessionActivityDate(sessionMetadata);
  const relativeActivity = formatCompactRelativeTime(activityDate, now);
  const workspaceName = getUriPathBasename(
    sessionMetadata.workspaceDirectory || "",
  );

  useEffect(() => {
    setSessionTitleEditValue(sessionMetadata.title);
  }, [sessionMetadata]);

  const shareSession = async (sessionId: string) => {
    // "session/share" is not supported in JetBrains yet
    if (shareSessionSupported) {
      await ideMessenger.request("session/share", {
        sessionId,
      });
    }
  };

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (sessionTitleEditValue !== sessionMetadata.title) {
        // imperfect solution of loading session just to update it
        // but fine for now, pretty low latency
        const currentSession = await getSession(
          ideMessenger,
          sessionMetadata.sessionId,
        );
        await dispatch(
          updateSession({
            ...currentSession,
            title: sessionTitleEditValue,
          }),
        );
      }
      setEditing(false);
    } else if (e.key === "Escape") {
      setSessionTitleEditValue(sessionMetadata.title);
      setEditing(false);
    }
  };

  const openSession = async () => {
    if (opening || editing) return;
    setOpening(true);

    // Route immediately so a slow session read cannot make the row appear
    // unresponsive. The requested session replaces the chat as soon as it is
    // available.
    navigate("/", { replace: true });
    try {
      await dispatch(exitEdit({})).unwrap();
      if (!isCurrentSession || shouldRehydratePersistedSession) {
        await dispatch(
          loadSession({
            sessionId: sessionMetadata.sessionId,
            // Persisted tabs restore their session id before the transcript has
            // been hydrated. Do not save that empty shell over the stored chat.
            saveCurrentSession: !isCurrentSession,
            forceReload: shouldRehydratePersistedSession,
          }),
        ).unwrap();
      }
    } catch (error) {
      console.error("Failed to open chat session", error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div
      role="listitem"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`history-row-${index}`}
      data-selected={isCurrentSession ? "true" : undefined}
      data-running={isRunning ? "true" : undefined}
      aria-current={isCurrentSession ? "page" : undefined}
      className="qivryn-history-row hover:bg-input relative mb-2 box-border flex w-full overflow-hidden rounded-lg p-3"
    >
      <div className="qivryn-history-row-content min-w-0 flex-1">
        {editing ? (
          <div>
            <Input
              type="text"
              className="w-full"
              ref={(titleInput) => titleInput && titleInput.focus()}
              value={sessionTitleEditValue}
              onChange={(e) => setSessionTitleEditValue(e.target.value)}
              onKeyUp={(e) => handleKeyUp(e)}
              onBlur={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Open chat ${sessionMetadata.title}${isRunning ? ", running" : ""}`}
            disabled={opening}
            onClick={() => void openSession()}
            className="qivryn-history-row-button flex w-full min-w-0 cursor-pointer flex-col border-none bg-transparent p-0 text-left disabled:cursor-wait disabled:opacity-70"
          >
            <span className="qivryn-history-row-primary">
              <span className="qivryn-history-row-title-wrap">
                {isRunning && <SessionRunningIndicator />}
                <span className="qivryn-history-row-title line-clamp-1 break-all text-sm font-semibold">
                  {sessionMetadata.title}
                </span>
              </span>
              <time
                className="qivryn-history-row-time"
                dateTime={activityDate.toISOString()}
                title={`Last active ${activityDate.toLocaleString()}`}
                aria-label={`Last active ${relativeActivity} ago`}
              >
                {relativeActivity}
              </time>
            </span>

            <span className="qivryn-history-row-secondary">
              {workspaceName && (
                <span className="qivryn-history-row-workspace line-clamp-1 break-all text-xs">
                  {workspaceName}
                </span>
              )}
              {sessionMetadata.messageCount !== undefined && (
                <span
                  className="qivryn-history-row-message-count"
                  title={`${sessionMetadata.messageCount} message${
                    sessionMetadata.messageCount === 1 ? "" : "s"
                  }`}
                  aria-label={`${sessionMetadata.messageCount} message${
                    sessionMetadata.messageCount === 1 ? "" : "s"
                  }`}
                >
                  <ChatBubbleLeftEllipsisIcon aria-hidden="true" />
                  {sessionMetadata.messageCount}
                </span>
              )}
            </span>
          </button>
        )}
      </div>

      {hovered && !editing && (
        <div className="qivryn-history-row-actions bg-input absolute right-2 top-1/2 ml-auto flex -translate-y-1/2 transform items-center gap-x-1 rounded-full px-2 py-1 shadow-md">
          {
            <>
              <HeaderButtonWithToolTip
                text="Edit"
                onClick={async (e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                <PencilSquareIcon width="1em" height="1em" />
              </HeaderButtonWithToolTip>
              {shareSessionSupported && (
                <HeaderButtonWithToolTip
                  text="Save Chat as Markdown"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await shareSession(sessionMetadata.sessionId);
                  }}
                >
                  <ArrowDownOnSquareIcon width="1em" height="1em" />
                </HeaderButtonWithToolTip>
              )}
              <HeaderButtonWithToolTip
                text="Delete"
                onClick={async (e) => {
                  e.stopPropagation();
                  await dispatch(deleteSession(sessionMetadata.sessionId));
                }}
              >
                <TrashIcon width="1em" height="1em" />
              </HeaderButtonWithToolTip>
            </>
          }
        </div>
      )}
    </div>
  );
}
