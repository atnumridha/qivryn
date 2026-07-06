import { randomUUID } from "node:crypto";
import type { BrowserEvent, BrowserSession } from "@qivryn/agent-runtime";
import type {
  BrowserActor,
  BrowserAdapter,
  BrowserPermissionAction,
  BrowserPermissionPolicy,
  BrowserPermissionGrant,
  BrowserScreenshot,
  BrowserStore,
  CreateBrowserSessionRequest,
} from "./contracts.js";

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

export class BrowserSessionService {
  constructor(
    private readonly store: BrowserStore,
    private readonly adapter: BrowserAdapter,
    private readonly permissions: BrowserPermissionPolicy,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    for (const session of await this.store.listSessions()) {
      try {
        const adapterState = await this.adapter.create(session);
        await this.save({
          ...session,
          ...adapterState,
          metadata: {
            ...session.metadata,
            ...adapterState?.metadata,
            recoveryError: undefined,
          },
        });
      } catch (error) {
        await this.save({
          ...session,
          metadata: {
            ...session.metadata,
            recoveryError:
              error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  async create(
    request: CreateBrowserSessionRequest = {},
  ): Promise<BrowserSession> {
    const now = new Date().toISOString();
    let session: BrowserSession = {
      id: randomUUID(),
      runId: request.runId,
      createdAt: now,
      updatedAt: now,
      url: request.url,
      visible: request.visible ?? false,
      locked: false,
      recording: request.recording ?? "events",
      viewport: request.viewport ?? { width: 1280, height: 720 },
      metadata: request.metadata,
    };
    const adapterState = await this.adapter.create(session);
    session = {
      ...session,
      ...adapterState,
      id: session.id,
      createdAt: session.createdAt,
    };
    await this.store.saveSession(session);
    if (request.url) await this.navigate(session.id, request.url, "user");
    return (await this.store.getSession(session.id))!;
  }

  list(): Promise<BrowserSession[]> {
    return this.store.listSessions();
  }

  get(sessionId: string): Promise<BrowserSession | undefined> {
    return this.store.getSession(sessionId);
  }

  events(sessionId: string, afterSequence?: number): Promise<BrowserEvent[]> {
    return this.store.readEvents(sessionId, afterSequence);
  }

  async close(sessionId: string, actor: BrowserActor = "user"): Promise<void> {
    const session = await this.require(sessionId, actor);
    await this.adapter.close(session);
    await this.event(sessionId, "closed", { actor });
    await this.store.deleteSession(sessionId);
  }

  async lock(sessionId: string, owner: BrowserActor): Promise<BrowserSession> {
    const session = await this.require(sessionId, owner, true);
    if (session.locked && session.lockOwner !== owner) {
      throw new Error(`Browser session is controlled by ${session.lockOwner}`);
    }
    const saved = await this.save({
      ...session,
      locked: true,
      lockOwner: owner,
    });
    await this.event(sessionId, "lock", { locked: true, owner });
    return saved;
  }

  async takeover(
    sessionId: string,
    owner: BrowserActor = "user",
  ): Promise<BrowserSession> {
    const session = await this.require(sessionId, owner, true);
    const saved = await this.save({
      ...session,
      locked: true,
      lockOwner: owner,
    });
    await this.event(sessionId, "lock", {
      locked: true,
      owner,
      takeover: true,
    });
    return saved;
  }

  async unlock(
    sessionId: string,
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    const session = await this.require(sessionId, actor);
    const saved = await this.save({
      ...session,
      locked: false,
      lockOwner: undefined,
    });
    await this.event(sessionId, "lock", { locked: false, actor });
    return saved;
  }

  async navigate(
    sessionId: string,
    url: string,
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    const session = await this.require(sessionId, actor);
    await this.authorize(session, actor, "navigate", url);
    const result = await this.adapter.navigate(session, url);
    const saved = await this.save({
      ...session,
      url: result.url,
      title: result.title,
    });
    await this.event(sessionId, "navigation", { actor, ...result });
    return saved;
  }

  async back(sessionId: string, actor: BrowserActor): Promise<BrowserSession> {
    return this.historyNavigation(sessionId, actor, "back");
  }

  async forward(
    sessionId: string,
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    return this.historyNavigation(sessionId, actor, "forward");
  }

  async reload(
    sessionId: string,
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    return this.historyNavigation(sessionId, actor, "reload");
  }

  async screenshot(
    sessionId: string,
    actor: BrowserActor,
  ): Promise<BrowserScreenshot> {
    const session = await this.require(sessionId, actor);
    const image = await this.adapter.screenshot(session);
    const event = await this.event(sessionId, "screenshot", {
      actor,
      mediaType: image.mediaType,
      byteLength: Buffer.byteLength(image.data, "base64"),
    });
    return { event, ...image };
  }

  async dom(
    sessionId: string,
    actor: BrowserActor,
  ): Promise<{ event: BrowserEvent; content: string }> {
    const session = await this.require(sessionId, actor);
    const content = await this.adapter.domSnapshot(session);
    return {
      event: await this.event(sessionId, "dom", {
        actor,
        length: content.length,
      }),
      content,
    };
  }

  async console(sessionId: string, actor: BrowserActor): Promise<unknown[]> {
    const session = await this.require(sessionId, actor);
    const logs = await this.adapter.consoleLogs(session);
    await Promise.all(
      logs.map((payload) => this.event(sessionId, "console", payload)),
    );
    return logs;
  }

  async network(sessionId: string, actor: BrowserActor): Promise<unknown[]> {
    const session = await this.require(sessionId, actor);
    const requests = await this.adapter.networkRequests(session);
    await Promise.all(
      requests.map((payload) => this.event(sessionId, "network", payload)),
    );
    return requests;
  }

  async viewport(
    sessionId: string,
    viewport: NonNullable<BrowserSession["viewport"]>,
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    if (
      viewport.width < 200 ||
      viewport.height < 200 ||
      viewport.width > 7680 ||
      viewport.height > 4320
    ) {
      throw new Error("Browser viewport must be between 200x200 and 7680x4320");
    }
    const session = await this.require(sessionId, actor);
    await this.adapter.setViewport(session, viewport);
    const saved = await this.save({ ...session, viewport });
    await this.event(sessionId, "viewport", { actor, viewport });
    return saved;
  }

  async recording(
    sessionId: string,
    recording: BrowserSession["recording"],
    actor: BrowserActor,
  ): Promise<BrowserSession> {
    const session = await this.require(sessionId, actor);
    const adapterState = await this.adapter.setRecording(session, recording);
    const saved = await this.save({
      ...session,
      ...adapterState,
      recording,
      metadata: {
        ...session.metadata,
        ...adapterState?.metadata,
      },
    });
    await this.event(sessionId, "recording", { actor, recording });
    return saved;
  }

  async authorizeSensitive(
    sessionId: string,
    action: Exclude<BrowserPermissionAction, "navigate">,
    actor: BrowserActor,
    url?: string,
  ): Promise<void> {
    const session = await this.require(sessionId, actor);
    await this.authorize(session, actor, action, url, true);
  }

  async listGrants(sessionId?: string): Promise<BrowserPermissionGrant[]> {
    return this.permissions.list?.(sessionId) ?? [];
  }

  async grant(
    sessionId: string,
    action: BrowserPermissionGrant["action"],
    origin?: string,
    expiresAt?: string,
  ): Promise<BrowserPermissionGrant> {
    await this.require(sessionId, "user", true);
    if (!this.permissions.grant)
      throw new Error("Browser permission grants are not supported");
    const grant = await this.permissions.grant({
      sessionId,
      actor: "agent",
      action,
      origin,
      expiresAt,
    });
    await this.event(sessionId, "permission", { type: "grant.created", grant });
    return grant;
  }

  async revokeGrant(sessionId: string, grantId: string): Promise<void> {
    await this.require(sessionId, "user", true);
    if (!this.permissions.revoke)
      throw new Error("Browser permission grants are not supported");
    await this.permissions.revoke(grantId);
    await this.event(sessionId, "permission", {
      type: "grant.revoked",
      grantId,
    });
  }

  private async authorize(
    session: BrowserSession,
    actor: BrowserActor,
    action: BrowserPermissionAction,
    url?: string,
    forceSensitive = false,
  ): Promise<void> {
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(
        session.url &&
          url &&
          new URL(session.url).origin === new URL(url).origin,
      );
    } catch {}
    const risk =
      !forceSensitive &&
      action === "navigate" &&
      (isLocalUrl(url ?? "") || sameOrigin)
        ? "safe"
        : "sensitive";
    const allowed =
      risk === "safe" ||
      (await this.permissions.authorize({
        session,
        actor,
        action,
        url,
        origin: url ? new URL(url).origin : undefined,
        risk,
      }));
    await this.event(session.id, "permission", {
      actor,
      action,
      url,
      risk,
      allowed,
    });
    if (!allowed) throw new Error(`Browser ${action} was not authorized`);
  }

  private async historyNavigation(
    sessionId: string,
    actor: BrowserActor,
    action: "back" | "forward" | "reload",
  ): Promise<BrowserSession> {
    const session = await this.require(sessionId, actor);
    const result =
      action === "back"
        ? await this.adapter.goBack(session)
        : action === "forward"
          ? await this.adapter.goForward(session)
          : await this.adapter.reload(session);
    const saved = await this.save({ ...session, ...result });
    await this.event(sessionId, "navigation", { actor, action, ...result });
    return saved;
  }

  private async require(
    sessionId: string,
    actor: BrowserActor,
    ignoreLock = false,
  ): Promise<BrowserSession> {
    const session = await this.store.getSession(sessionId);
    if (!session)
      throw new Error(`Browser session ${sessionId} does not exist`);
    if (
      !ignoreLock &&
      session.locked &&
      session.lockOwner &&
      session.lockOwner !== actor
    ) {
      throw new Error(`Browser session is controlled by ${session.lockOwner}`);
    }
    return session;
  }

  private save(session: BrowserSession): Promise<BrowserSession> {
    return this.store.saveSession({
      ...session,
      updatedAt: new Date().toISOString(),
    });
  }

  private event(
    sessionId: string,
    kind: BrowserEvent["kind"],
    payload: unknown,
  ): Promise<BrowserEvent> {
    return this.store.appendEvent({
      sessionId,
      kind,
      createdAt: new Date().toISOString(),
      payload,
    });
  }
}
