import { BaseSessionMetadata } from "core";

export const parseDate = (date: string): Date => {
  let dateObj = new Date(date);
  if (isNaN(dateObj.getTime())) {
    const numericDate = Number.parseInt(date, 10);
    dateObj = new Date(Number.isNaN(numericDate) ? 0 : numericDate);
  }
  return dateObj;
};

export const getSessionActivityDate = (session: BaseSessionMetadata): Date =>
  parseDate(session.dateUpdated ?? session.dateCreated);

export const getSessionActivityTime = (
  session: BaseSessionMetadata,
): number => {
  const timestamp = getSessionActivityDate(session).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const formatCompactRelativeTime = (
  date: Date,
  now: number = Date.now(),
): string => {
  const elapsedMinutes = Math.max(
    1,
    Math.floor((now - date.getTime()) / (60 * 1000)),
  );

  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.max(1, Math.floor(elapsedHours / 24));
  if (elapsedDays < 7) return `${elapsedDays}d`;
  if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}w`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}mo`;
  return `${Math.floor(elapsedDays / 365)}y`;
};

export interface SessionGroup {
  label: string;
  sessions: BaseSessionMetadata[];
}

export const groupSessionsByDate = (
  sessions: BaseSessionMetadata[],
  runningSessionIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): SessionGroup[] => {
  const yesterday = new Date(now - 1000 * 60 * 60 * 24);
  const lastWeek = new Date(now - 1000 * 60 * 60 * 24 * 7);
  const lastMonth = new Date(now - 1000 * 60 * 60 * 24 * 30);

  const groups: SessionGroup[] = [];
  const runningSessions = sessions.filter((session) =>
    runningSessionIds.has(session.sessionId),
  );
  const completedSessions = sessions.filter(
    (session) => !runningSessionIds.has(session.sessionId),
  );

  const todaySessions = completedSessions.filter(
    (session) => getSessionActivityDate(session) > yesterday,
  );
  const weekSessions = completedSessions.filter((session) => {
    const date = getSessionActivityDate(session);
    return date <= yesterday && date > lastWeek;
  });
  const monthSessions = completedSessions.filter((session) => {
    const date = getSessionActivityDate(session);
    return date <= lastWeek && date > lastMonth;
  });
  const olderSessions = completedSessions.filter(
    (session) => getSessionActivityDate(session) <= lastMonth,
  );

  if (runningSessions.length > 0)
    groups.push({ label: "Running", sessions: runningSessions });
  if (todaySessions.length > 0)
    groups.push({ label: "Today", sessions: todaySessions });
  if (weekSessions.length > 0)
    groups.push({ label: "This Week", sessions: weekSessions });
  if (monthSessions.length > 0)
    groups.push({ label: "This Month", sessions: monthSessions });
  if (olderSessions.length > 0)
    groups.push({ label: "Older", sessions: olderSessions });

  return groups;
};
