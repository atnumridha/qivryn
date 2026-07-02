import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import {
  normalizeVoiceTranscript,
  preferredAudioMimeType,
  VoiceInputButton,
} from "./VoiceInputButton";

class MockMediaRecorder {
  static latest: MockMediaRecorder;
  static isTypeSupported = vi.fn((type: string) =>
    type.startsWith("audio/webm"),
  );
  state: RecordingState = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onerror?: () => void;
  onstop?: () => void;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.ondataavailable?.({
      data: new Blob(["audio"], { type: this.mimeType }),
    });
    this.state = "inactive";
    this.onstop?.();
  });

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    MockMediaRecorder.latest = this;
  }
}

const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;

function installMediaMocks() {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
  stopTrack.mockClear();
});

describe("VoiceInputButton", () => {
  it("normalizes transcripts and selects a supported recording format", () => {
    installMediaMocks();
    expect(normalizeVoiceTranscript("  review   the\nchange ")).toBe(
      "review the change",
    );
    expect(preferredAudioMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("records, transcribes, allows review, and cancels", async () => {
    installMediaMocks();
    const messenger = new MockIdeMessenger();
    messenger.responses["voice/transcribe"] = { text: "review this change" };
    const { user } = await renderWithProviders(<VoiceInputButton />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: "Start voice input" }),
    );
    expect(
      await screen.findByRole("button", { name: "Stop voice input" }),
    ).toBeVisible();
    expect(MockMediaRecorder.latest.start).toHaveBeenCalledWith(1_000);
    await new Promise((resolve) => setTimeout(resolve, 510));

    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: "Stop voice input" }),
      );
    });
    expect(
      await screen.findByRole("textbox", { name: "Voice transcript" }),
    ).toHaveValue("review this change");
    expect(stopTrack).toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox", { name: "Voice transcript" }));
    await user.type(
      screen.getByRole("textbox", { name: "Voice transcript" }),
      "updated prompt",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Voice transcript" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("falls back to native host capture when the webview denies access", async () => {
    installMediaMocks();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    const messenger = new MockIdeMessenger();
    const requests: string[] = [];
    messenger.responseHandlers["voice/captureStart"] = async () => {
      requests.push("start");
      return { captureId: "native-1", recorder: "ffmpeg" };
    };
    messenger.responseHandlers["voice/captureStop"] = async () => {
      requests.push("stop");
      return { audioBase64: "UklGRg==", mimeType: "audio/wav" };
    };
    const { user } = await renderWithProviders(<VoiceInputButton />, {
      mockIdeMessenger: messenger,
    });
    await user.click(
      await screen.findByRole("button", { name: "Start voice input" }),
    );
    await waitFor(() => expect(requests).toContain("start"));
    await new Promise((resolve) => setTimeout(resolve, 510));
    await user.click(
      await screen.findByRole("button", { name: "Stop voice input" }),
    );
    await waitFor(() => expect(requests).toEqual(["start", "stop"]));
    expect(
      await screen.findByRole("textbox", { name: "Voice transcript" }),
    ).toHaveValue("Transcribed voice input");
  });

  it("stays hidden when MediaRecorder is unavailable", async () => {
    await renderWithProviders(<VoiceInputButton />);
    expect(
      screen.queryByRole("button", { name: "Start voice input" }),
    ).not.toBeInTheDocument();
  });
});
