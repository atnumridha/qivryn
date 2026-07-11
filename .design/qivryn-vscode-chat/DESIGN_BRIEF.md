# Qivryn VS Code Chat Design Brief

## Target

Match the supplied Codex-in-VS-Code references at the interaction-pattern level while remaining native to the active VS Code theme.

## Principles

1. Conversation is the canvas. Assistant prose is not placed inside a card.
2. Hierarchy comes from spacing, typography, and alignment before borders or fills.
3. User prompts remain compact, right-aligned, neutral bubbles.
4. Tool activity is a quiet disclosure row. Only expanded terminal, code, diff, and plan content receives a framed surface.
5. The composer is one raised surface with one internal divider and one control baseline.
6. All colors resolve from VS Code theme tokens. Focus, warning, success, and selection states retain host semantics.
7. Narrow sidebars preserve labels where they add meaning, but hide secondary metadata before controls wrap or collide.

## Layout Tokens

- Canvas inset: `12px` narrow, `16px` standard, `20px` expanded.
- Reading measure: full available width with prose constrained to `920px` only in standalone/maximized chat.
- Control height: `28px`; send control: `30px`.
- Corners: `4px` compact controls, `6px` menus/output, `10px` user bubbles and composer.
- Borders: one-pixel host token; no decorative nested borders.
- Elevation: composer and floating menus only.

## QA Matrix

- VS Code right sidebar at approximately 280-360px.
- VS Code right sidebar at approximately 420-520px.
- Standalone/maximized Qivryn chat at 1280px and 1920px.
- Empty, active streaming, completed response, incomplete response, tool group, terminal output, attachment menu, model menu, reasoning menu, and `$` skill picker states.
- Keyboard focus, 200% zoom, reduced motion, long model names, long skill names, and high-contrast theme tokens.
