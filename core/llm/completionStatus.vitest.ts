import { ChatMessage } from "..";
import { describe, expect, it } from "vitest";
import {
  fromChatCompletionChunk,
  fromResponsesChunk,
} from "./openaiTypeConverters";

describe("completion status metadata", () => {
  it("marks a length-limited chat completion as incomplete", () => {
    const result = fromChatCompletionChunk({
      id: "chatcmpl-limited",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "length",
          logprobs: null,
        },
      ],
    } as any);

    expect(result?.metadata).toMatchObject({
      completionStatus: "incomplete",
      completionReason: "length",
    });
  });

  it("marks a completed Responses stream as complete", () => {
    const result = fromResponsesChunk({
      type: "response.completed",
      response: { id: "resp-complete" },
    } as any);

    expect((result as ChatMessage)?.metadata).toMatchObject({
      completionStatus: "complete",
      completionReason: "stop",
    });
  });

  it("preserves the Responses API incomplete reason", () => {
    const result = fromResponsesChunk({
      type: "response.incomplete",
      response: {
        id: "resp-limited",
        incomplete_details: { reason: "max_output_tokens" },
      },
    } as any);

    expect((result as ChatMessage)?.metadata).toMatchObject({
      completionStatus: "incomplete",
      completionReason: "max_output_tokens",
    });
  });
});
