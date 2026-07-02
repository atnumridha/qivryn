import {
  MAX_AGENT_ATTACHMENT_TOTAL_BYTES,
  MAX_AGENT_IMAGE_ATTACHMENTS,
  MAX_AGENT_IMAGE_SIZE_BYTES,
} from "@continuedev/agent-runtime";
import type { ChatHistoryItem } from "core/index.js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { formatMessageWithFiles } from "../ui/hooks/useChat.helpers.js";

export async function formatHeadlessMessageWithImages(
  prompt: string,
  imagePaths: readonly string[],
): Promise<ChatHistoryItem> {
  if (imagePaths.length === 0) {
    return formatMessageWithFiles(prompt, []);
  }
  if (imagePaths.length > MAX_AGENT_IMAGE_ATTACHMENTS) {
    throw new Error(
      `At most ${MAX_AGENT_IMAGE_ATTACHMENTS} images can be attached`,
    );
  }

  const imageMap = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const [index, imagePath] of imagePaths.entries()) {
    const absolutePath = path.resolve(imagePath);
    const imageStat = await stat(absolutePath);
    if (!imageStat.isFile()) {
      throw new Error(`Image attachment is not a file: ${imagePath}`);
    }
    if (imageStat.size < 1 || imageStat.size > MAX_AGENT_IMAGE_SIZE_BYTES) {
      throw new Error(
        `Image attachment must be between 1 and ${MAX_AGENT_IMAGE_SIZE_BYTES} bytes: ${imagePath}`,
      );
    }
    totalBytes += imageStat.size;
    if (totalBytes > MAX_AGENT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(
        `Image attachments exceed the ${MAX_AGENT_ATTACHMENT_TOTAL_BYTES}-byte total limit`,
      );
    }
    imageMap.set(`[Image #${index + 1}]`, await readFile(absolutePath));
  }

  const placeholders = [...imageMap.keys()].join("\n");
  return formatMessageWithFiles(`${prompt}\n\n${placeholders}`, [], imageMap);
}
