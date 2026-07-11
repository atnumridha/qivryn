import { describe, expect, it } from "vitest";
import { getAttachmentMenuPosition } from "./attachmentMenuPosition";

describe("getAttachmentMenuPosition", () => {
  it("opens above a composer control near the bottom edge", () => {
    expect(
      getAttachmentMenuPosition({
        anchor: { top: 730, right: 430, bottom: 758 },
        viewportWidth: 447,
        viewportHeight: 838,
        menuWidth: 192,
        menuHeight: 76,
      }),
    ).toEqual({
      left: 238,
      top: 648,
      width: 192,
      maxHeight: 76,
      placement: "above",
    });
  });

  it("opens below when there is not enough room above the trigger", () => {
    expect(
      getAttachmentMenuPosition({
        anchor: { top: 24, right: 48, bottom: 52 },
        viewportWidth: 320,
        viewportHeight: 600,
        menuWidth: 192,
        menuHeight: 76,
      }),
    ).toEqual({
      left: 8,
      top: 58,
      width: 192,
      maxHeight: 76,
      placement: "below",
    });
  });

  it("keeps the menu within a narrow viewport", () => {
    expect(
      getAttachmentMenuPosition({
        anchor: { top: 220, right: 154, bottom: 248 },
        viewportWidth: 160,
        viewportHeight: 320,
        menuWidth: 192,
        menuHeight: 76,
      }),
    ).toMatchObject({
      left: 8,
      width: 144,
      placement: "above",
    });
  });

  it("limits menu height to the larger available side", () => {
    expect(
      getAttachmentMenuPosition({
        anchor: { top: 70, right: 240, bottom: 98 },
        viewportWidth: 280,
        viewportHeight: 180,
        menuWidth: 192,
        menuHeight: 140,
      }),
    ).toEqual({
      left: 48,
      top: 104,
      width: 192,
      maxHeight: 68,
      placement: "below",
    });
  });
});
