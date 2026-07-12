import {
  AgentAttachmentKind,
  AgentImageMediaType,
  type AgentInputAttachment,
  type AgentRun,
  validateAgentAttachments,
} from "@qivryn/agent-runtime";
import { fileURLToPath } from "node:url";

export function imagePathsForAgentRun(run: AgentRun): string[] {
  const attachments = run.attachments ?? [];
  validateAgentAttachments(attachments);
  return attachments
    .filter(
      (attachment): attachment is AgentInputAttachment =>
        attachment.kind === AgentAttachmentKind.Image,
    )
    .map((attachment) => fileURLToPath(attachment.uri));
}

const imageExtensions: Record<AgentImageMediaType, string> = {
  [AgentImageMediaType.Gif]: ".gif",
  [AgentImageMediaType.Jpeg]: ".jpg",
  [AgentImageMediaType.Png]: ".png",
  [AgentImageMediaType.Webp]: ".webp",
};

export function executionImageNamesForAgentRun(run: AgentRun): string[] {
  const attachments = run.attachments ?? [];
  validateAgentAttachments(attachments);
  return attachments.map(
    (attachment, index) =>
      `image-${index + 1}${imageExtensions[attachment.mediaType]}`,
  );
}

export function buildAgentChatArgs(
  run: AgentRun,
  imagePaths = imagePathsForAgentRun(run),
): string[] {
  const hookContext =
    typeof run.metadata?.hookAdditionalContext === "string"
      ? run.metadata.hookAdditionalContext.trim()
      : "";
  const prompt = hookContext
    ? `${run.prompt}\n\n<system-reminder>\n${hookContext}\n</system-reminder>`
    : run.prompt;
  const args = [prompt, "--print", "--beta-subagent-tool"];
  for (const imagePath of imagePaths) {
    args.push("--image", imagePath);
  }
  if (run.permissionMode === "readOnly") args.push("--readonly");
  if (run.permissionMode === "autonomous") args.push("--autonomous");
  if (run.permissionMode === "fullAccess") args.push("--auto");
  if (run.model) args.push("--model", run.model);
  return args;
}
