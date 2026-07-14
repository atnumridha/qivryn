import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolCallDisplay } from "./ToolCallDisplay";

describe("ToolCallDisplay", () => {
  it("collapses completed output behind one disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallDisplay
        icon={<span aria-hidden="true">tool</span>}
        tool={undefined}
        toolCallState={
          {
            toolCallId: "tool-1",
            toolCall: { function: { name: "terminal", arguments: "{}" } },
            status: "done",
            parsedArgs: {},
          } as any
        }
        historyIndex={0}
      >
        <div>three lines of terminal output</div>
      </ToolCallDisplay>,
    );

    const details = screen.getByText("Agent tool use").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(
      screen.getByText("three lines of terminal output"),
    ).not.toBeVisible();

    await user.click(screen.getByText("Agent tool use"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("three lines of terminal output")).toBeVisible();
  });

  it("keeps an active call expanded until it completes", () => {
    render(
      <ToolCallDisplay
        icon={<span aria-hidden="true">tool</span>}
        tool={undefined}
        toolCallState={
          {
            toolCallId: "tool-2",
            toolCall: { function: { name: "terminal", arguments: "{}" } },
            status: "calling",
            parsedArgs: {},
          } as any
        }
        historyIndex={0}
      >
        <div>running output</div>
      </ToolCallDisplay>,
    );

    expect(
      screen.getByText("Agent tool use").closest("details"),
    ).toHaveAttribute("open");
  });
});
