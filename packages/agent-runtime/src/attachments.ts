import {
  AgentAttachmentKind,
  AgentImageMediaType,
  type AgentInputAttachment,
} from "./contracts.js";

export const MAX_AGENT_IMAGE_ATTACHMENTS = 4;
export const MAX_AGENT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

const imageMediaTypes = new Set<string>(Object.values(AgentImageMediaType));

export function validateAgentAttachments(
  attachments: readonly AgentInputAttachment[],
): void {
  if (attachments.length > MAX_AGENT_IMAGE_ATTACHMENTS) {
    throw new Error(
      `Agent runs support at most ${MAX_AGENT_IMAGE_ATTACHMENTS} image attachments`,
    );
  }

  let totalBytes = 0;
  const ids = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.kind !== AgentAttachmentKind.Image) {
      throw new Error(`Unsupported agent attachment kind: ${attachment.kind}`);
    }
    if (!imageMediaTypes.has(attachment.mediaType)) {
      throw new Error(
        `Unsupported agent image media type: ${attachment.mediaType}`,
      );
    }
    if (!attachment.id.trim() || ids.has(attachment.id)) {
      throw new Error("Agent attachment IDs must be non-empty and unique");
    }
    ids.add(attachment.id);
    if (!attachment.name.trim()) {
      throw new Error("Agent attachment names must be non-empty");
    }
    if (!attachment.uri.startsWith("file://")) {
      throw new Error("Agent image attachments must use durable file:// URIs");
    }
    if (
      !Number.isSafeInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 1 ||
      attachment.sizeBytes > MAX_AGENT_IMAGE_SIZE_BYTES
    ) {
      throw new Error(
        `Agent image attachments must be between 1 and ${MAX_AGENT_IMAGE_SIZE_BYTES} bytes`,
      );
    }
    totalBytes += attachment.sizeBytes;
  }

  if (totalBytes > MAX_AGENT_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(
      `Agent image attachments exceed the ${MAX_AGENT_ATTACHMENT_TOTAL_BYTES}-byte total limit`,
    );
  }
}
