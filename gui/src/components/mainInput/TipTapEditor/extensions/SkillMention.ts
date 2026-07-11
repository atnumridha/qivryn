import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { SuggestionOptions } from "@tiptap/suggestion";
import { ComboBoxItem } from "../../types";

export type SkillMentionOptions = {
  HTMLAttributes: Record<string, unknown>;
  suggestion: Omit<SuggestionOptions<ComboBoxItem, ComboBoxItem>, "editor">;
};

export const SkillMention = Node.create<SkillMentionOptions>({
  name: "skill-mention",

  addOptions() {
    return {
      HTMLAttributes: {
        class: "skill-mention",
      },
      suggestion: {
        char: "$",
        pluginKey: new PluginKey(this.name),
        command: ({ editor, range, props }) => {
          const nodeAfter = editor.view.state.selection.$to.nodeAfter;
          if (nodeAfter?.text?.startsWith(" ")) {
            range.to += 1;
          }

          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: this.name,
                attrs: props,
              },
              {
                type: "text",
                text: " ",
              },
            ])
            .run();

          window.getSelection()?.collapseToEnd();
        },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const type = state.schema.nodes[this.name];
          return !!$from.parent.type.contentMatch.matchType(type);
        },
      },
    };
  },

  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-id": attributes.id } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) =>
          attributes.label ? { "data-label": attributes.label } : {},
      },
      description: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-description"),
        renderHTML: (attributes) =>
          attributes.description
            ? { "data-description": attributes.description }
            : {},
      },
      itemType: {
        default: "skill",
        parseHTML: (element) => element.getAttribute("data-item-type"),
        renderHTML: (attributes) =>
          attributes.itemType ? { "data-item-type": attributes.itemType } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `$${node.attrs.label ?? node.attrs.id}`,
    ];
  },

  renderText({ node }) {
    return `$${node.attrs.label ?? node.attrs.id}`;
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          const { empty, anchor } = state.selection;
          if (!empty || anchor <= 0) {
            return false;
          }

          let removedSkill = false;
          state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
            if (node.type.name !== this.name) {
              return;
            }
            removedSkill = true;
            tr.insertText("$", pos, pos + node.nodeSize);
            return false;
          });
          return removedSkill;
        }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
