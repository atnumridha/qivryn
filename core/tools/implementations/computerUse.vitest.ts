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
    const list = vi.fn(async () => []);
    registerBrowserService(
      { create, list, navigate } as never,
      Promise.resolve(),
    );

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

  it("reuses an unlocked browser session on the same Slack origin", async () => {
    const existing = {
      ...browserSession(),
      id: "slack-session",
      url: "https://app.slack.com/client/T1/C1",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const create = vi.fn();
    const navigate = vi.fn(async () => existing);
    const list = vi.fn(async () => [existing]);
    registerBrowserService(
      { create, list, navigate } as never,
      Promise.resolve(),
    );

    const output = await computerUseImpl(
      { action: "create", url: "https://app.slack.com/client/T1/C2" },
      {} as never,
    );

    expect(create).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      "slack-session",
      "https://app.slack.com/client/T1/C2",
      "agent",
      true,
    );
    expect(output[0].description).toBe("Browser session reused");
  });

  it("creates a separate browser when reuse is explicitly disabled", async () => {
    const create = vi.fn(async () => browserSession());
    const navigate = vi.fn(async () => browserSession());
    const list = vi.fn(async () => [browserSession()]);
    registerBrowserService(
      { create, list, navigate } as never,
      Promise.resolve(),
    );

    await computerUseImpl(
      {
        action: "create",
        url: "https://example.test/private",
        reuseExisting: false,
      },
      {} as never,
    );

    expect(list).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
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
