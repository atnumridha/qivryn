import { describe, expect, it } from "vitest";
import {
  AgentAttachmentKind,
  AgentImageMediaType,
  MAX_AGENT_IMAGE_ATTACHMENTS,
  MAX_AGENT_IMAGE_SIZE_BYTES,
  validateAgentAttachments,
  type AgentInputAttachment,
} from "../src/index.js";

function image(
  id: string,
  sizeBytes = 1,
  uri = `file:///tmp/${id}.png`,
): AgentInputAttachment {
  return {
    id,
    kind: AgentAttachmentKind.Image,
    name: `${id}.png`,
    mediaType: AgentImageMediaType.Png,
    uri,
    sizeBytes,
  };
}

describe("validateAgentAttachments", () => {
  it("accepts bounded durable image attachments", () => {
    expect(() =>
      validateAgentAttachments([image("one"), image("two")]),
    ).not.toThrow();
  });

  it("rejects duplicate IDs and non-file URIs", () => {
    expect(() =>
      validateAgentAttachments([image("one"), image("one")]),
    ).toThrow("non-empty and unique");
    expect(() =>
      validateAgentAttachments([image("one", 1, "https://example.com/a.png")]),
    ).toThrow("file://");
  });

  it("enforces attachment count and total-size boundaries", () => {
    expect(() =>
      validateAgentAttachments(
        Array.from({ length: MAX_AGENT_IMAGE_ATTACHMENTS + 1 }, (_, index) =>
          image(String(index)),
        ),
      ),
    ).toThrow("at most");
    expect(() =>
      validateAgentAttachments([
        image("one", MAX_AGENT_IMAGE_SIZE_BYTES),
        image("two", MAX_AGENT_IMAGE_SIZE_BYTES),
        image("three", 1),
      ]),
    ).toThrow("total limit");
  });
});
