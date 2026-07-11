import { describe, expect, it } from "vitest";
import {
  formatCompactRelativeTime,
  getSessionActivityTime,
  groupSessionsByDate,
} from "./util";

const now = new Date("2026-07-11T12:00:00.000Z").getTime();

function session(
  sessionId: string,
  activityTime: number,
  dateCreated: number = activityTime,
) {
  return {
    sessionId,
    title: sessionId,
    dateCreated: String(dateCreated),
    dateUpdated: String(activityTime),
    workspaceDirectory: "/workspace",
  };
}

describe("history activity formatting", () => {
  it.each([
    [1, "1m"],
    [59, "59m"],
    [60, "1h"],
    [23 * 60, "23h"],
    [24 * 60, "1d"],
    [8 * 24 * 60, "1w"],
    [35 * 24 * 60, "1mo"],
    [370 * 24 * 60, "1y"],
  ])("formats %i elapsed minutes as %s", (elapsedMinutes, expected) => {
    expect(
      formatCompactRelativeTime(
        new Date(now - elapsedMinutes * 60 * 1000),
        now,
      ),
    ).toBe(expected);
  });

  it("uses the updated time before the creation time", () => {
    expect(getSessionActivityTime(session("recent", now, 0))).toBe(now);
  });

  it("pins running sessions in their own first group", () => {
    const completed = session("completed", now - 2 * 60 * 1000);
    const running = session("running", now - 30 * 24 * 60 * 60 * 1000);
    const groups = groupSessionsByDate(
      [running, completed],
      new Set(["running"]),
      now,
    );

    expect(groups.map((group) => group.label)).toEqual(["Running", "Today"]);
    expect(groups[0].sessions[0].sessionId).toBe("running");
  });
});
