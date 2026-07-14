import {
  AgentAttachmentKind,
  AgentImageMediaType,
  type AgentRun,
} from "@qivryn/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  agentSessionIdForRun,
  buildAgentChatArgs,
  executionImageNamesForAgentRun,
} from "./agentProcessArgs.js";

const RUN_SESSION_ID = agentSessionIdForRun("run-1");

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    revision: 0,
    title: "Inspect image",
    prompt: "Describe the attached image",
    status: "queued",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: "/workspace",
    },
    ...overrides,
  };
}

describe("buildAgentChatArgs", () => {
  it("passes durable image paths to the headless CLI", () => {
    const args = buildAgentChatArgs(
      run({
        attachments: [
          {
            id: "image-1",
            kind: AgentAttachmentKind.Image,
            name: "screen shot.png",
            mediaType: AgentImageMediaType.Png,
            uri: "file:///tmp/screen%20shot.png",
            sizeBytes: 128,
          },
        ],
      }),
    );

    expect(args).toEqual([
      "Describe the attached image",
      "--print",
      "--session-id",
      RUN_SESSION_ID,
      "--beta-subagent-tool",
      "--image",
      "/tmp/screen shot.png",
      "--autonomous",
    ]);
  });

  it("generates MIME-recognizable execution filenames", () => {
    expect(
      executionImageNamesForAgentRun(
        run({
          attachments: [
            {
              id: "image-1",
              kind: AgentAttachmentKind.Image,
              name: "photo",
              mediaType: AgentImageMediaType.Jpeg,
              uri: "file:///tmp/photo",
              sizeBytes: 128,
            },
            {
              id: "image-2",
              kind: AgentAttachmentKind.Image,
              name: "diagram",
              mediaType: AgentImageMediaType.Webp,
              uri: "file:///tmp/diagram",
              sizeBytes: 128,
            },
          ],
        }),
      ),
    ).toEqual(["image-1.jpg", "image-2.webp"]);
  });

  it("preserves permission and model flags without images", () => {
    expect(
      buildAgentChatArgs(run({ permissionMode: "readOnly", model: "model" })),
    ).toEqual([
      "Describe the attached image",
      "--print",
      "--session-id",
      RUN_SESSION_ID,
      "--beta-subagent-tool",
      "--readonly",
      "--model",
      "model",
    ]);
  });

  it("keeps managed ask-mode tools available for interactive approval", () => {
    expect(buildAgentChatArgs(run({ permissionMode: "ask" }))).toEqual([
      "Describe the attached image",
      "--print",
      "--session-id",
      RUN_SESSION_ID,
      "--beta-subagent-tool",
      "--ask",
      "*",
    ]);
  });

  it("keeps one isolated session ID across prompts for the same run", () => {
    const initialArgs = buildAgentChatArgs(
      run({ id: "run-a", prompt: "Initial task" }),
    );
    const followUpArgs = buildAgentChatArgs(
      run({ id: "run-a", prompt: "Follow-up task" }),
    );
    const otherRunArgs = buildAgentChatArgs(
      run({ id: "run-b", prompt: "Other task" }),
    );
    const sessionId = (args: string[]) =>
      args[args.indexOf("--session-id") + 1];

    expect(initialArgs[0]).toBe("Initial task");
    expect(followUpArgs[0]).toBe("Follow-up task");
    expect(sessionId(initialArgs)).toBe(sessionId(followUpArgs));
    expect(sessionId(otherRunArgs)).not.toBe(sessionId(initialArgs));
  });
});
