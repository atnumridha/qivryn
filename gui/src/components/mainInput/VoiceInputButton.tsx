import {
  ArrowPathIcon,
  MicrophoneIcon,
  StopIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useContext, useEffect, useRef, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useMainEditor } from "./TipTapEditor";

const RECORDING_LIMIT_MS = 5 * 60 * 1_000;
const MIN_RECORDING_MS = 500;
const BROWSER_CAPTURE_TIMEOUT_MS = 6_000;
const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
];

type VoiceStatus =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "processing"
  | "reviewing"
  | "error";

interface VoiceInputButtonProps {
  disabled?: boolean;
  onInsert?: (text: string) => void;
}

interface RecordedAudio {
  audioBase64: string;
  mimeType: string;
}

export function normalizeVoiceTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = blob.arrayBuffer
    ? await blob.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read recording."));
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(blob);
      });
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function microphoneSettingsUri(): string | undefined {
  if (/Mac/i.test(navigator.platform)) {
    return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  }
  if (/Win/i.test(navigator.platform)) return "ms-settings:privacy-microphone";
  return undefined;
}

function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied by VS Code or the operating system.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Connect an input device and retry.";
  }
  if (name === "AbortError")
    return "Voice input was interrupted. Please retry.";
  const message = error instanceof Error ? error.message : String(error);
  if (/Voice transcription returned no text/i.test(message)) {
    return "No speech was detected in the recording. Try again with a longer, clearer prompt.";
  }
  return message;
}

function isVsCodeWebview(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof (window as any).acquireVsCodeApi === "function" ||
      Boolean((window as any).vscode))
  );
}

export function VoiceInputButton({
  disabled = false,
  onInsert,
}: VoiceInputButtonProps = {}) {
  const { mainEditor } = useMainEditor();
  const ideMessenger = useContext(IdeMessengerContext);
  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hostCaptureRef = useRef<string>();
  const recordingStartedAtRef = useRef<number>();
  const discardRef = useRef(false);
  const operationRef = useRef(0);
  const recordedAudioRef = useRef<RecordedAudio>();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>();

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  };

  const reset = () => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    const recorder = recorderRef.current;
    recorderRef.current = undefined;
    discardRef.current = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cleanupStream();
    recordingStartedAtRef.current = undefined;
    chunksRef.current = [];
    discardRef.current = false;
    recordedAudioRef.current = undefined;
    setStatus("idle");
    setTranscript("");
    setError(undefined);
  };

  useEffect(() => {
    return () => {
      if (hostCaptureRef.current) {
        ideMessenger.post("voice/captureCancel", {
          captureId: hostCaptureRef.current,
        });
      }
      reset();
    };
    // reset intentionally owns the mutable capture refs used during teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideMessenger]);

  const transcribeAudio = async (
    audioBase64: string,
    mimeType: string,
    operation = operationRef.current,
  ) => {
    recordedAudioRef.current = { audioBase64, mimeType };
    if (operation !== operationRef.current) return;
    setStatus("processing");
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    abortRef.current = controller;
    controller.signal.addEventListener(
      "abort",
      () => ideMessenger.post("voice/transcribeCancel", { requestId }),
      { once: true },
    );
    try {
      const response = await ideMessenger.request("voice/transcribe", {
        audioBase64,
        mimeType,
        language: navigator.language || "en-US",
        requestId,
      });
      if (controller.signal.aborted || operation !== operationRef.current)
        return;
      if (response.status === "error") throw new Error(response.error);
      const nextTranscript = normalizeVoiceTranscript(response.content.text);
      if (!nextTranscript) {
        throw new Error("Voice transcription returned no text.");
      }
      setTranscript(nextTranscript);
      setStatus("reviewing");
    } catch (cause) {
      if (controller.signal.aborted || operation !== operationRef.current)
        return;
      setError(microphoneError(cause));
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  };

  const finishRecording = async (mimeType: string, operation: number) => {
    cleanupStream();
    recorderRef.current = undefined;
    if (operation !== operationRef.current) return;
    if (discardRef.current) {
      reset();
      return;
    }

    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (!blob.size) {
      setError("No audio was recorded.");
      setStatus("error");
      return;
    }
    await transcribeAudio(await blobToBase64(blob), mimeType, operation);
  };

  const startHostCapture = async (operation: number): Promise<boolean> => {
    const fallback = await ideMessenger.request(
      "voice/captureStart",
      undefined,
    );
    if (operation !== operationRef.current) {
      if (fallback.status === "success") {
        ideMessenger.post("voice/captureCancel", {
          captureId: fallback.content.captureId,
        });
      }
      return true;
    }
    if (fallback.status !== "success") {
      throw new Error(fallback.error);
    }

    hostCaptureRef.current = fallback.content.captureId;
    recordingStartedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(() => void stop(), RECORDING_LIMIT_MS);
    setStatus("recording");
    return true;
  };

  const getUserMediaWithTimeout = async (
    constraints: MediaStreamConstraints,
  ): Promise<MediaStream> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Browser microphone capture timed out.")),
        BROWSER_CAPTURE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const start = async (selectedDeviceId = deviceId) => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    abortRef.current?.abort();
    setError(undefined);
    setTranscript("");
    recordedAudioRef.current = undefined;
    setStatus("requesting_permission");
    discardRef.current = false;
    let nativeCaptureError: unknown;
    if (isVsCodeWebview()) {
      try {
        if (await startHostCapture(operation)) {
          return;
        }
      } catch (cause) {
        nativeCaptureError = cause;
      }
    }
    try {
      if (
        typeof MediaRecorder === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        throw new Error("Browser microphone capture is unavailable.");
      }
      const stream = await getUserMediaWithTimeout({
        audio: {
          ...(selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (operation !== operationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const available = (
        await navigator.mediaDevices.enumerateDevices()
      ).filter((device) => device.kind === "audioinput");
      setDevices(available);
      const mimeType = preferredAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        cleanupStream();
        setError("Recording was interrupted. Please retry.");
        setStatus("error");
      };
      recorder.onstop = () =>
        void finishRecording(
          recorder.mimeType || chunksRef.current[0]?.type || "audio/webm",
          operation,
        );
      recorder.start(1_000);
      recordingStartedAtRef.current = Date.now();
      timeoutRef.current = setTimeout(() => stop(), RECORDING_LIMIT_MS);
      setStatus("recording");
    } catch (cause) {
      cleanupStream();
      if (operation !== operationRef.current) return;
      try {
        if (nativeCaptureError === undefined) {
          await startHostCapture(operation);
          return;
        }
        setError(
          `${microphoneError(nativeCaptureError)} Browser recorder fallback failed: ${microphoneError(cause)}`,
        );
        setStatus("error");
      } catch (fallbackCause) {
        if (operation !== operationRef.current) return;
        const fallbackMessage =
          fallbackCause instanceof Error
            ? fallbackCause.message
            : String(fallbackCause);
        setError(
          `${microphoneError(cause)} Native recorder fallback failed: ${fallbackMessage}`,
        );
        setStatus("error");
        return;
      }
    }
  };

  const stop = async () => {
    const operation = operationRef.current;
    const recordingWasTooShort =
      recordingStartedAtRef.current !== undefined &&
      Date.now() - recordingStartedAtRef.current < MIN_RECORDING_MS;
    const hostCaptureId = hostCaptureRef.current;
    if (hostCaptureId) {
      hostCaptureRef.current = undefined;
      if (recordingWasTooShort) {
        await ideMessenger.request("voice/captureCancel", {
          captureId: hostCaptureId,
        });
        reset();
        return;
      }
      cleanupStream();
      setStatus("processing");
      const response = await ideMessenger.request("voice/captureStop", {
        captureId: hostCaptureId,
      });
      if (operation !== operationRef.current) return;
      if (response.status === "error") {
        setError(response.error);
        setStatus("error");
        return;
      }
      await transcribeAudio(
        response.content.audioBase64,
        response.content.mimeType,
        operation,
      );
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      if (recordingWasTooShort) discardRef.current = true;
      recorder.stop();
    }
  };

  const cancel = () => {
    const hostCaptureId = hostCaptureRef.current;
    hostCaptureRef.current = undefined;
    if (hostCaptureId) {
      void ideMessenger.request("voice/captureCancel", {
        captureId: hostCaptureId,
      });
    }
    reset();
  };

  useEffect(() => {
    const handleVoiceCommand = (event: MessageEvent) => {
      if (event.data?.type !== "qivryn.voice.toggle") return;
      if (disabled && status === "idle") return;
      if (status === "recording") {
        void stop();
      } else if (status === "idle" || status === "error") {
        void start();
      } else {
        cancel();
      }
    };
    window.addEventListener("message", handleVoiceCommand);
    return () => window.removeEventListener("message", handleVoiceCommand);
  });

  const accept = () => {
    const text = normalizeVoiceTranscript(transcript);
    if (text) {
      if (onInsert) onInsert(text);
      else if (mainEditor) mainEditor.chain().focus().insertContent(text).run();
    }
    reset();
  };

  const retry = () => {
    const recordedAudio = recordedAudioRef.current;
    if (!recordedAudio) return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setError(undefined);
    void transcribeAudio(
      recordedAudio.audioBase64,
      recordedAudio.mimeType,
      operation,
    );
  };

  const switchDevice = async (nextDeviceId: string) => {
    setDeviceId(nextDeviceId);
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanupStream();
    // Let MediaRecorder's stop event release the previous stream first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await start(nextDeviceId);
  };

  const busy = ["requesting_permission", "recording", "processing"].includes(
    status,
  );
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label={
          status === "recording"
            ? "Stop voice input"
            : busy
              ? "Cancel voice input"
              : "Start voice input"
        }
        title={status === "recording" ? "Stop voice input" : "Voice input"}
        onClick={(event) => {
          event.stopPropagation();
          if (status === "recording") stop();
          else if (busy) cancel();
          else void start();
        }}
        disabled={disabled && status === "idle"}
        className={`qivryn-voice-input-button hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded-full border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 ${status === "recording" ? "text-error" : "text-description"}`}
      >
        {status === "recording" ? (
          <StopIcon className="h-3.5 w-3.5" />
        ) : status === "requesting_permission" || status === "processing" ? (
          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MicrophoneIcon className="h-3.5 w-3.5" />
        )}
      </button>
      {status !== "idle" && (
        <div className="border-input bg-editor absolute bottom-8 right-0 z-50 box-border w-[min(320px,calc(100vw-24px))] rounded-lg border p-2 shadow-lg">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
            {status === "requesting_permission"
              ? "Requesting microphone access"
              : status === "recording"
                ? "Listening…"
                : status === "processing"
                  ? "Transcribing…"
                  : status === "error"
                    ? "Voice input unavailable"
                    : "Review voice input"}
            <button
              type="button"
              aria-label="Cancel voice input"
              onClick={cancel}
              className="hover:bg-list-hover ml-auto flex h-5 w-5 items-center justify-center rounded border-none bg-transparent"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          {status === "recording" && devices.length > 1 && (
            <select
              aria-label="Microphone"
              value={deviceId ?? ""}
              onChange={(event) => void switchDevice(event.target.value)}
              className="border-input bg-input mb-1 box-border w-full rounded border px-1.5 py-1 text-xs"
            >
              <option value="">System default</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          )}
          {status === "error" ? (
            <div>
              <div role="alert" className="text-error text-2xs break-words">
                {error}
              </div>
              {microphoneSettingsUri() &&
                /microphone.*(?:access|permission)|denied/i.test(
                  error ?? "",
                ) && (
                  <button
                    type="button"
                    className="text-link text-2xs mt-1 border-none bg-transparent p-0 underline"
                    onClick={() =>
                      void ideMessenger.ide.openUrl(microphoneSettingsUri()!)
                    }
                  >
                    Open microphone settings
                  </button>
                )}
              {recordedAudioRef.current && (
                <button
                  type="button"
                  className="hover:bg-list-hover text-2xs mt-2 rounded border-none bg-transparent px-2 py-1"
                  onClick={retry}
                >
                  Retry transcription
                </button>
              )}
            </div>
          ) : status === "reviewing" ? (
            <>
              <textarea
                aria-label="Voice transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={3}
                className="border-input bg-input box-border w-full resize-none rounded border p-1.5 text-xs outline-none"
              />
              <div className="mt-1 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={cancel}
                  className="hover:bg-list-hover text-2xs rounded border-none bg-transparent px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!transcript.trim()}
                  onClick={accept}
                  className="bg-button text-2xs rounded border-none px-2 py-1 text-white disabled:opacity-50"
                >
                  Insert
                </button>
              </div>
            </>
          ) : (
            <div className="text-description text-2xs">
              {status === "processing"
                ? "Processing the recording. You can cancel at any time."
                : "Speak naturally, then press Stop to review the transcript."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
