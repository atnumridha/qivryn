import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILLM } from "..";
import { transcribeVoiceAudio } from "./voiceTranscription";

const model = {
  providerName: "openai",
  underlyingProviderName: "openai",
  apiKey: "test-key",
  apiBase: "https://example.com/v1",
} as ILLM;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CONTINUE_VOICE_TRANSCRIPTION_URL;
  delete process.env.CONTINUE_VOICE_TRANSCRIPTION_API_KEY;
  delete process.env.CONTINUE_VOICE_TRANSCRIPTION_MODEL;
  delete process.env.CONTINUE_VOICE_LOCAL_TRANSCRIPTION;
});

describe("transcribeVoiceAudio", () => {
  it("posts MediaRecorder audio to an OpenAI-compatible transcription endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: " review this change " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeVoiceAudio(
        {
          audioBase64: Buffer.from("audio").toString("base64"),
          mimeType: "audio/webm;codecs=opus",
          language: "en-US",
        },
        model,
      ),
    ).resolves.toEqual({ text: "review this change" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-key" },
        body: expect.any(FormData),
      }),
    );
  });

  it("supports a keyless local transcription endpoint", async () => {
    process.env.CONTINUE_VOICE_TRANSCRIPTION_URL =
      "http://127.0.0.1:8080/v1/audio/transcriptions";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: "local result" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const localModel = {
      providerName: "ollama",
      underlyingProviderName: "ollama",
    } as ILLM;
    await transcribeVoiceAudio(
      {
        audioBase64: Buffer.from("audio").toString("base64"),
        mimeType: "audio/wav",
      },
      localModel,
    );

    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it("returns an actionable error when transcription is unavailable", async () => {
    process.env.CONTINUE_VOICE_LOCAL_TRANSCRIPTION = "false";
    await expect(
      transcribeVoiceAudio({ audioBase64: "YQ==", mimeType: "audio/webm" }, {
        providerName: "chatgpt-codex",
        underlyingProviderName: "openai",
      } as ILLM),
    ).rejects.toThrow("CONTINUE_VOICE_TRANSCRIPTION_URL");
  });
});
