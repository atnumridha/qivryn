import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

interface HostCapture {
  child: ChildProcessByStdio<Writable, null, Readable>;
  filePath: string;
  closed: Promise<number | null>;
  stderr: string;
}

const captures = new Map<string, HostCapture>();

export function ffmpegExecutable(): string {
  const configured = process.env.QIVRYN_FFMPEG_PATH;
  if (configured) return configured;
  const candidates =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
      : process.platform === "win32"
        ? ["ffmpeg.exe"]
        : ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function captureArguments(outputPath: string): string[] {
  const input =
    process.platform === "darwin"
      ? ["-f", "avfoundation", "-i", ":0"]
      : process.platform === "linux"
        ? ["-f", "pulse", "-i", "default"]
        : ["-f", "dshow", "-i", "audio=default"];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    ...input,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-y",
    outputPath,
  ];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startHostVoiceCapture(): Promise<{
  captureId: string;
  recorder: "ffmpeg";
}> {
  const captureId = randomBytes(12).toString("hex");
  const filePath = path.join(os.tmpdir(), `qivryn-voice-${captureId}.wav`);
  const child = spawn(ffmpegExecutable(), captureArguments(filePath), {
    stdio: ["pipe", "ignore", "pipe"],
  });
  const capture: HostCapture = {
    child,
    filePath,
    stderr: "",
    closed: new Promise((resolve) => child.once("close", resolve)),
  };
  child.stderr.on("data", (chunk) => {
    capture.stderr = `${capture.stderr}${String(chunk)}`.slice(-4_000);
  });
  captures.set(captureId, capture);

  const startup = await Promise.race([
    new Promise<Error>((resolve) =>
      child.once("error", (error) => resolve(error)),
    ),
    capture.closed.then(
      (code) =>
        new Error(
          `Recorder exited during startup (${code ?? "unknown"}): ${capture.stderr.trim()}`,
        ),
    ),
    wait(450).then(() => undefined),
  ]);
  if (startup instanceof Error) {
    captures.delete(captureId);
    await unlink(filePath).catch(() => undefined);
    throw startup;
  }
  return { captureId, recorder: "ffmpeg" };
}

async function stopProcess(capture: HostCapture): Promise<void> {
  if (capture.child.exitCode === null && capture.child.signalCode === null) {
    capture.child.kill("SIGINT");
  }
  await Promise.race([capture.closed.then(() => undefined), wait(3_000)]);
  if (capture.child.exitCode === null && capture.child.signalCode === null) {
    capture.child.kill("SIGKILL");
    await capture.closed;
  }
}

export async function stopHostVoiceCapture(captureId: string): Promise<{
  audioBase64: string;
  mimeType: "audio/wav";
}> {
  const capture = captures.get(captureId);
  if (!capture) throw new Error("Voice capture is no longer active");
  captures.delete(captureId);
  await stopProcess(capture);
  try {
    const audio = await readFile(capture.filePath);
    if (audio.byteLength <= 44) {
      throw new Error(
        `No microphone audio was captured. ${capture.stderr.trim()}`.trim(),
      );
    }
    return { audioBase64: audio.toString("base64"), mimeType: "audio/wav" };
  } finally {
    await unlink(capture.filePath).catch(() => undefined);
  }
}

export async function cancelHostVoiceCapture(captureId: string): Promise<void> {
  const capture = captures.get(captureId);
  if (!capture) return;
  captures.delete(captureId);
  await stopProcess(capture);
  await unlink(capture.filePath).catch(() => undefined);
}
