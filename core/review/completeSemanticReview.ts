import type { ChatMessage, ILLM } from "../index.js";
import { renderChatMessage } from "../util/messageContent.js";

export type SemanticReviewModel = Pick<ILLM, "chat" | "providerName">;

export async function completeSemanticReview(
  model: SemanticReviewModel,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response: ChatMessage = await model.chat(
    [{ role: "user", content: prompt }],
    signal,
    model.providerName === "chatgpt-codex"
      ? { maxTokens: 4_000 }
      : { temperature: 0, maxTokens: 4_000 },
  );

  return renderChatMessage(response);
}
