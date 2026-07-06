import type { BrowserEvent, BrowserSession } from "@qivryn/agent-runtime";

export type BrowserActor = "user" | "agent";
export type BrowserPermissionAction =
  | "navigate"
  | "download"
  | "dialog"
  | "authentication"
  | "certificate"
  | "clipboard"
  | "geolocation";

export interface CreateBrowserSessionRequest {
  runId?: string;
  visible?: boolean;
  url?: string;
  recording?: BrowserSession["recording"];
  viewport?: BrowserSession["viewport"];
  metadata?: Record<string, unknown>;
}

export interface BrowserPermissionRequest {
  session: BrowserSession;
  actor: BrowserActor;
  action: BrowserPermissionAction;
  url?: string;
  origin?: string;
  risk: "safe" | "sensitive";
}

export interface BrowserPermissionPolicy {
  authorize(request: BrowserPermissionRequest): Promise<boolean>;
  list?(sessionId?: string): Promise<BrowserPermissionGrant[]>;
  grant?(
    grant: Omit<BrowserPermissionGrant, "id" | "createdAt">,
  ): Promise<BrowserPermissionGrant>;
  revoke?(grantId: string): Promise<void>;
}

export interface BrowserPermissionGrant {
  id: string;
  sessionId: string;
  actor: "agent";
  action: Exclude<BrowserPermissionAction, "navigate"> | "navigate";
  origin?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface BrowserAdapter {
  create(session: BrowserSession): Promise<Partial<BrowserSession> | void>;
  close(session: BrowserSession): Promise<void>;
  navigate(
    session: BrowserSession,
    url: string,
  ): Promise<{ url: string; title?: string }>;
  goBack(session: BrowserSession): Promise<{ url: string; title?: string }>;
  goForward(session: BrowserSession): Promise<{ url: string; title?: string }>;
  reload(session: BrowserSession): Promise<{ url: string; title?: string }>;
  screenshot(
    session: BrowserSession,
  ): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" }>;
  domSnapshot(session: BrowserSession): Promise<string>;
  consoleLogs(session: BrowserSession): Promise<unknown[]>;
  networkRequests(session: BrowserSession): Promise<unknown[]>;
  setViewport(
    session: BrowserSession,
    viewport: NonNullable<BrowserSession["viewport"]>,
  ): Promise<void>;
  setRecording(
    session: BrowserSession,
    recording: BrowserSession["recording"],
  ): Promise<Partial<BrowserSession> | void>;
}

export interface BrowserStore {
  initialize(): Promise<void>;
  saveSession(session: BrowserSession): Promise<BrowserSession>;
  getSession(sessionId: string): Promise<BrowserSession | undefined>;
  listSessions(): Promise<BrowserSession[]>;
  deleteSession(sessionId: string): Promise<void>;
  appendEvent(
    event: Omit<BrowserEvent, "id" | "sequence">,
  ): Promise<BrowserEvent>;
  readEvents(
    sessionId: string,
    afterSequence?: number,
  ): Promise<BrowserEvent[]>;
}

export interface BrowserScreenshot {
  event: BrowserEvent;
  data: string;
  mediaType: "image/png" | "image/jpeg";
}

export type BrowserActionRequest =
  | { action: "close"; sessionId: string; actor?: BrowserActor }
  | { action: "navigate"; sessionId: string; url: string; actor?: BrowserActor }
  | { action: "back"; sessionId: string; actor?: BrowserActor }
  | { action: "forward"; sessionId: string; actor?: BrowserActor }
  | { action: "reload"; sessionId: string; actor?: BrowserActor }
  | { action: "lock"; sessionId: string; actor?: BrowserActor }
  | { action: "takeover"; sessionId: string; actor?: BrowserActor }
  | { action: "unlock"; sessionId: string; actor?: BrowserActor }
  | { action: "screenshot"; sessionId: string; actor?: BrowserActor }
  | { action: "dom"; sessionId: string; actor?: BrowserActor }
  | { action: "console"; sessionId: string; actor?: BrowserActor }
  | { action: "network"; sessionId: string; actor?: BrowserActor }
  | {
      action: "viewport";
      sessionId: string;
      viewport: NonNullable<BrowserSession["viewport"]>;
      actor?: BrowserActor;
    }
  | {
      action: "recording";
      sessionId: string;
      recording: BrowserSession["recording"];
      actor?: BrowserActor;
    };

export type BrowserActionResult =
  | BrowserSession
  | BrowserScreenshot
  | { event: BrowserEvent; content: string }
  | unknown[]
  | void;
