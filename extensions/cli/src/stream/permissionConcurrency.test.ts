import { afterEach, describe, expect, it } from "vitest";

import { toolPermissionManager } from "../permissions/permissionManager.js";
import { writeFileTool } from "../tools/writeFile.js";
import type { PreprocessedToolCall } from "../tools/types.js";
import { requestUserPermission } from "./streamChatResponse.helpers.js";

function toolCall(id: string, path: string): PreprocessedToolCall {
  return {
    id,
    name: writeFileTool.name,
    arguments: { filepath: path, content: "updated" },
    argumentsStr: JSON.stringify({ filepath: path, content: "updated" }),
    startNotified: false,
    tool: writeFileTool,
  };
}

describe("parallel permission requests", () => {
  afterEach(() => toolPermissionManager.rejectAllPending());

  it("correlates same-name tools by tool-call ID", async () => {
    const requests: Array<{ approvalId: string; toolCallId?: string }> = [];
    const callbacks = {
      onToolPermissionRequest: (
        _toolName: string,
        _args: unknown,
        approvalId: string,
        _preview: unknown,
        toolCallId?: string,
      ) => requests.push({ approvalId, toolCallId }),
    };

    const first = requestUserPermission(
      toolCall("call-a", "/workspace/a.ts"),
      callbacks,
    );
    const second = requestUserPermission(
      toolCall("call-b", "/workspace/b.ts"),
      callbacks,
    );

    expect(requests.map(({ toolCallId }) => toolCallId)).toEqual([
      "call-a",
      "call-b",
    ]);
    toolPermissionManager.approveRequest(requests[1].approvalId);
    toolPermissionManager.rejectRequest(requests[0].approvalId);

    await expect(Promise.all([first, second])).resolves.toEqual([false, true]);
  });
});
