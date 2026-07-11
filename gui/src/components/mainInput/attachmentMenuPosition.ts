export interface AttachmentMenuAnchorRect {
  top: number;
  right: number;
  bottom: number;
}

export interface AttachmentMenuPositionOptions {
  anchor: AttachmentMenuAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth: number;
  menuHeight: number;
  viewportGap?: number;
  triggerGap?: number;
}

export interface AttachmentMenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export function getAttachmentMenuPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  menuWidth,
  menuHeight,
  viewportGap = 8,
  triggerGap = 6,
}: AttachmentMenuPositionOptions): AttachmentMenuPosition {
  const availableWidth = Math.max(0, viewportWidth - viewportGap * 2);
  const width = Math.min(menuWidth, availableWidth);
  const spaceAbove = Math.max(0, anchor.top - viewportGap - triggerGap);
  const spaceBelow = Math.max(
    0,
    viewportHeight - anchor.bottom - viewportGap - triggerGap,
  );
  const placement =
    spaceAbove >= menuHeight || spaceAbove >= spaceBelow ? "above" : "below";
  const availableHeight = placement === "above" ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(menuHeight, availableHeight);
  const maximumLeft = Math.max(
    viewportGap,
    viewportWidth - viewportGap - width,
  );
  const left = clamp(anchor.right - width, viewportGap, maximumLeft);
  const top =
    placement === "above"
      ? Math.max(viewportGap, anchor.top - triggerGap - maxHeight)
      : Math.min(
          viewportHeight - viewportGap - maxHeight,
          anchor.bottom + triggerGap,
        );

  return {
    left,
    top,
    width,
    maxHeight,
    placement,
  };
}
