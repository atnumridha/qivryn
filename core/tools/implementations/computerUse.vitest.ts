import { describe, expect, it, vi } from "vitest";
import { registerBrowserService } from "../../context/browser/BrowserServiceSingleton";
import { computerUseImpl } from "./computerUse";

function browserSession() {
  return {
    id: "browser-1",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    url: "https://example.test",
    title: "Example",
    visible: false,
    locked: false,
    recording: "events" as const,
  };
}

describe("computerUseImpl", () => {
  it("creates and navigates an approved agent browser session", async () => {
    const create = vi.fn(async () => browserSession());
    const navigate = vi.fn(async () => browserSession());
    registerBrowserService({ create, navigate } as never, Promise.resolve());

    const output = await computerUseImpl(
      {
        action: "create",
        url: "https://example.test",
        visible: false,
      },
      {} as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ visible: false, recording: "events" }),
    );
    expect(navigate).toHaveBeenCalledWith(
      "browser-1",
      "https://example.test",
      "agent",
      true,
    );
    expect(output[0].content).toContain('"sessionId": "browser-1"');
  });

  it("uses selector-based typing without exposing text in the result", async () => {
    const typeText = vi.fn(async () => browserSession());
    registerBrowserService({ typeText } as never, Promise.resolve());

    const output = await computerUseImpl(
      {
        action: "type",
        sessionId: "browser-1",
        selector: "#password",
        text: "do-not-echo",
        replace: true,
      },
      {} as never,
    );

    expect(typeText).toHaveBeenCalledWith(
      "browser-1",
      {
        selector: "#password",
        text: "do-not-echo",
        replace: true,
      },
      "agent",
      true,
    );
    expect(JSON.stringify(output)).not.toContain("do-not-echo");
  });
});
