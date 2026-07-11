import Image from "@tiptap/extension-image";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { JSONContent } from "@tiptap/react";
import {
  ContextItemWithId,
  MessagePart,
  RangeInFile,
  TextMessagePart,
} from "core";
import { ctxItemToRifWithContents } from "core/commands/util";
import { getUriDescription } from "core/util/uri";
import { CodeBlock, Mention, PromptBlock, SkillMention } from "../extensions";
import { GetContextRequest } from "./types";

interface MentionAttrs {
  label: string;
  id: string;
  itemType?: string;
  query?: string;
}

function resolvePromptBlock(p: JSONContent): string | undefined {
  return p.attrs?.item.name;
}

function resolveParagraph(p: JSONContent): {
  text: string;
  contextRequests: GetContextRequest[];
  skillNames: string[];
} {
  const contextRequests: GetContextRequest[] = [];
  const skillNames: string[] = [];
  let text = "";
  let stripSkillSpacer = false;

  for (const child of p.content || []) {
    switch (child.type) {
      case Text.name: {
        let childText = child.text ?? "";
        if (stripSkillSpacer && childText.startsWith(" ")) {
          childText = childText.slice(1);
        }
        stripSkillSpacer = false;
        text += childText;
        break;
      }
      case Mention.name: {
        const attrs = child.attrs as MentionAttrs;
        contextRequests.push({
          provider:
            attrs.itemType === "contextProvider" ? attrs.id : attrs.itemType!,
          query: attrs.query,
        });
        text += child.attrs?.renderInlineAs ?? child.attrs?.label;
        break;
      }
      case SkillMention.name: {
        const skillName = child.attrs?.id ?? child.attrs?.label;
        if (typeof skillName === "string" && skillName.trim()) {
          skillNames.push(skillName.trim());
        }
        stripSkillSpacer = true;
        break;
      }
      default:
        console.warn("Unexpected child type", child.type);
    }
  }

  return { text: text.trimStart(), contextRequests, skillNames };
}

export function processEditorContent(editorState: JSONContent) {
  const contextRequests: GetContextRequest[] = [];
  const selectedCode: RangeInFile[] = [];
  let slashCommandName: string | undefined;
  const skillNames: string[] = [];

  const parts: MessagePart[] = [];
  for (const p of editorState?.content || []) {
    switch (p.type) {
      case PromptBlock.name:
        slashCommandName = resolvePromptBlock(p);
        break;
      case Paragraph.name:
        const resolvedParagraph = resolveParagraph(p);
        const { text } = resolvedParagraph;

        contextRequests.push(...resolvedParagraph.contextRequests);
        skillNames.push(...resolvedParagraph.skillNames);

        if (text) {
          // Merge with previous text part if possible
          if (parts[parts.length - 1]?.type === "text") {
            (parts[parts.length - 1] as TextMessagePart).text += "\n" + text;
          } else {
            parts.push({ type: "text", text });
          }
        }
        break;
      case CodeBlock.name:
        if (!p.attrs?.item) {
          console.warn("codeBlock has no item attribute");
          break;
        }

        const contextItem = p.attrs.item as ContextItemWithId;
        const rif = ctxItemToRifWithContents(contextItem, true);
        selectedCode.push(rif);

        // If editing, only include in selectedCode
        if (contextItem.editing) {
          break;
        }

        const { extension, relativePathOrBasename } = getUriDescription(
          rif.filepath,
          window.workspacePaths ?? [],
        );
        const codeText = `\n\`\`\`${extension} ${relativePathOrBasename} (${rif.range.start.line + 1}-${rif.range.end.line + 1})\n${contextItem.content}\n\`\`\`\n`;

        if (parts[parts.length - 1]?.type === "text") {
          (parts[parts.length - 1] as TextMessagePart).text += "\n" + codeText;
        } else {
          parts.push({ type: "text", text: codeText });
        }
        break;
      case Image.name:
        parts.push({
          type: "imageUrl",
          imageUrl: { url: p.attrs?.src },
        });
        break;
      default: {
        console.warn("Unexpected content type", p.type);
      }
    }
  }

  const uniqueSkillNames = [...new Set(skillNames)];
  if (uniqueSkillNames.length > 0) {
    const skillInstructions = uniqueSkillNames
      .map(
        (skillName) =>
          `Use the ${JSON.stringify(skillName)} skill for this task.`,
      )
      .join("\n");
    const firstPart = parts[0];
    if (firstPart?.type === "text") {
      firstPart.text = `${skillInstructions}\n\n${firstPart.text}`;
    } else {
      parts.unshift({ type: "text", text: skillInstructions });
    }
  }

  return { parts, contextRequests, selectedCode, slashCommandName };
}
