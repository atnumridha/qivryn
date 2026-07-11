import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallStatusMessage } from "./ToolCallStatusMessage";

describe("ToolCallStatusMessage", () => {
  it("joins completed tool status text without duplicate whitespace", () => {
    render(
      <ToolCallStatusMessage
        tool={
          {
            displayTitle: "Read file",
            function: { name: "read_file" },
            hasAlready: "read the current file",
          } as any
        }
        toolCallState={
          {
            status: "done",
            parsedArgs: {},
          } as any
        }
      />,
    );

    expect(screen.getByTestId("tool-call-title")).toHaveTextContent(
      "Qivryn read the current file",
    );
    expect(screen.getByTestId("tool-call-title").textContent).not.toContain(
      "  ",
    );
  });
});
