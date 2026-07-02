import type { ILLM } from "..";
import { spawn } from "node:child_process";
import path from "node:path";
import { ffmpegExecutable } from "./hostVoiceCapture";
import { getQivrynGlobalPath } from "./paths";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_LOCAL_TRANSCRIPTION_MODEL = "Xenova/whisper-tiny";

type LocalTranscriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let localTranscriberPromise: Promise<LocalTranscriber> | undefined;

export interface VoiceTranscriptionRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
}

export interface VoiceTranscriptionResult {
  text: string;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "audio/mp4" || normalized === "audio/m4a") return "m4a";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return "wav";
  return "webm";
}

function openAiCompatibleEndpoint(model: ILLM): string | undefined {
  if (process.env.QIVRYN_VOICE_TRANSCRIPTION_URL) {
    return process.env.QIVRYN_VOICE_TRANSCRIPTION_URL;
  }

  const provider =
    `${model.providerName} ${model.underlyingProviderName}`.toLowerCase();
  if (
    !model.apiKey ||
    !provider.includes("openai") ||
    provider.includes("chatgpt")
  ) {
    return undefined;
  }

  const base = (model.apiBase || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  return `${base}/audio/transcriptions`;
}

function languageCode(language?: string): string | undefined {
  const normalized = language?.trim();
  if (!normalized) return undefined;
  return normalized.split(/[-_]/, 1)[0].toLowerCase();
}

async function decodeAudio(audio: Buffer, signal?: AbortSignal) {
  const child = spawn(
    ffmpegExecutable(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const output: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4_000);
  });
  const onAbort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stdin.end(audio);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (signal?.aborted) throw new Error("Voice transcription was canceled.");
    if (code !== 0) {
      throw new Error(
        `Unable to decode the recording${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
      );
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const pcm = Buffer.concat(output);
  if (pcm.byteLength < 2) throw new Error("No audio was recorded.");
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = pcm.readInt16LE(index * 2) / 32_768;
  }
  return samples;
}

async function getLocalTranscriber(): Promise<LocalTranscriber> {
  if (!localTranscriberPromise) {
    localTranscriberPromise = (async () => {
      const transformers = await import("@xenova/transformers");
      transformers.env.cacheDir = path.join(
        getQivrynGlobalPath(),
        "models",
        "voice",
      );
      return (await transformers.pipeline(
        "automatic-speech-recognition",
        process.env.QIVRYN_VOICE_LOCAL_MODEL ||
          DEFAULT_LOCAL_TRANSCRIPTION_MODEL,
        { quantized: true },
      )) as unknown as LocalTranscriber;
    })().catch((error) => {
      localTranscriberPromise = undefined;
      throw error;
    });
  }
  return localTranscriberPromise;
}

async function transcribeLocally(
  audio: Buffer,
  signal?: AbortSignal,
): Promise<VoiceTranscriptionResult> {
  try {
    const samples = await decodeAudio(audio, signal);
    const transcriber = await getLocalTranscriber();
    if (signal?.aborted) throw new Error("Voice transcription was canceled.");
    const output = await transcriber(samples, {
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    if (signal?.aborted) throw new Error("Voice transcription was canceled.");
    const text = (Array.isArray(output) ? output : [output])
      .map((item) => item.text ?? "")
      .join(" ")
      .trim();
    if (!text) throw new Error("Voice transcription returned no text.");
    return { text };
  } catch (error) {
    throw new Error(
      `Local voice transcription failed. The first use downloads and caches a small Whisper model. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function transcribeVoiceAudio(
  request: VoiceTranscriptionRequest,
  model: ILLM,
  signal?: AbortSignal,
): Promise<VoiceTranscriptionResult> {
  const endpoint = openAiCompatibleEndpoint(model);
  if (!endpoint && process.env.QIVRYN_VOICE_LOCAL_TRANSCRIPTION === "false") {
    throw new Error(
      "Voice transcription is not configured. Enable local transcription or set QIVRYN_VOICE_TRANSCRIPTION_URL to a local or remote OpenAI-compatible /audio/transcriptions endpoint.",
    );
  }

  const audio = Buffer.from(request.audioBase64, "base64");
  if (audio.length === 0) throw new Error("No audio was recorded.");
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error("Voice recordings are limited to 25 MB.");
  }
  if (!endpoint) return transcribeLocally(audio, signal);

  const form = new FormData();
  form.append(
    "file",
    new Blob([audio], { type: request.mimeType }),
    `qivryn-voice.${extensionForMimeType(request.mimeType)}`,
  );
  form.append(
    "model",
    process.env.QIVRYN_VOICE_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
  );
  const language = languageCode(request.language);
  if (language) form.append("language", language);

  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const apiKey = process.env.QIVRYN_VOICE_TRANSCRIPTION_API_KEY || model.apiKey;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form,
    signal: combinedSignal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Voice transcription failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error("Voice transcription returned no text.");
  }
  return { text: body.text.trim() };
}
