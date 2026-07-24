import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { InternalMcpOptions, MCPServerStatus } from "../..";
import MCPConnection, { MCPExtras } from "./MCPConnection";

const MAX_MCP_CONNECTION_REFRESH_CONCURRENCY = 3;
const MAX_MCP_STARTUP_CONNECTION_REFRESH_CONCURRENCY = 1;
const MCP_CONNECTION_ERROR_COOLDOWN_MS = 5 * 60 * 1000;
const AUTO_REFRESH_MCP_ON_STARTUP =
  typeof process !== "undefined" &&
  process.env?.QIVRYN_AUTO_REFRESH_MCP_ON_STARTUP === "true";

export class MCPManagerSingleton {
  private static instance: MCPManagerSingleton;

  public onConnectionsRefreshed?: () => void;
  public connections: Map<string, MCPConnection> = new Map();

  private abortController: AbortController = new AbortController();
  private failedConnectionCooldowns: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): MCPManagerSingleton {
    if (!MCPManagerSingleton.instance) {
      MCPManagerSingleton.instance = new MCPManagerSingleton();
    }
    return MCPManagerSingleton.instance;
  }

  async setEnabled(serverId: string, enabled: boolean) {
    const conn = this.connections.get(serverId);
    if (conn) {
      if (enabled) {
        conn.status = "not-connected";
        await this.refreshConnection(serverId);
      } else {
        try {
          await conn.disconnect(true);
        } catch (e) {
          console.error(`Error disconnecting from MCP server ${serverId}`, e);
        }
      }
    }
  }

  createConnection(id: string, options: InternalMcpOptions): MCPConnection {
    if (this.connections.has(id)) {
      return this.connections.get(id)!;
    } else {
      const connection = new MCPConnection(options);
      this.connections.set(id, connection);
      return connection;
    }
  }

  getConnection(id: string) {
    return this.connections.get(id);
  }

  async shutdown() {
    if (this.connections.size > 0) {
      await Promise.allSettled(
        Array.from(this.connections.entries()).map(([id, connection]) => {
          try {
            connection.abortController.abort();
            void connection.client.close();
          } finally {
            this.connections.delete(id);
          }
        }),
      );
    }
  }

  setConnections(
    servers: InternalMcpOptions[],
    forceRefresh: boolean,
    extras?: MCPExtras,
  ) {
    let refresh = false;

    // Remove any connections that are no longer in config
    Array.from(this.connections.entries()).forEach(([id, connection]) => {
      if (
        !servers.find(
          // Refresh the connection if TransportOptions changed
          (s) =>
            s.id === id && this.compareTransportOptions(connection.options, s),
        )
      ) {
        refresh = true;
        connection.abortController.abort();
        void connection.client.close();
        this.connections.delete(id);
        this.failedConnectionCooldowns.delete(id);
      }
    });

    // Add any connections that are not yet in manager
    servers.forEach((server) => {
      if (this.connections.has(server.id)) {
        const conn = this.connections.get(server.id);
        if (conn) {
          // We need to update it. Some attributes may have changed, such as name, faviconUrl, etc.
          conn.options = server;
        }
      } else {
        refresh = true;
        this.connections.set(server.id, new MCPConnection(server, extras));
      }
    });

    // Register optional MCP servers without blocking the first coding-agent turn.
    // Built-in file, search, edit, and terminal tools are available separately.
    if (refresh && (forceRefresh || AUTO_REFRESH_MCP_ON_STARTUP)) {
      void this.refreshConnections(forceRefresh);
    }
  }

  private compareTransportOptions(
    a: InternalMcpOptions,
    b: InternalMcpOptions,
  ): boolean {
    if (a.type !== b.type) {
      return false;
    }
    if ("command" in a && "command" in b) {
      return (
        a.command === b.command &&
        JSON.stringify(a.args) === JSON.stringify(b.args) &&
        this.compareEnv(a.env, b.env)
      );
    } else if ("url" in a && "url" in b) {
      return a.url === b.url;
    }
    return false;
  }

  private compareEnv(
    aEnv: Record<string, string> | undefined,
    bEnv: Record<string, string> | undefined,
  ): boolean {
    const a = aEnv ?? {};
    const b = bEnv ?? {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    return (
      aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key])
    );
  }

  async refreshConnection(serverId: string) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`MCP Connection ${serverId} not found`);
    }
    this.failedConnectionCooldowns.delete(serverId);
    await connection.connectClient(true, this.abortController.signal);
    if (this.onConnectionsRefreshed) {
      this.onConnectionsRefreshed();
    }
  }

  private async refreshConnectionWithCooldown(
    connection: MCPConnection,
    force: boolean,
    signal: AbortSignal,
  ) {
    const serverId = connection.options.id;
    const cooldownUntil = this.failedConnectionCooldowns.get(serverId);
    if (!force && cooldownUntil !== undefined && cooldownUntil > Date.now()) {
      return;
    }

    await connection.connectClient(force, signal);

    if (connection.status === "error") {
      this.failedConnectionCooldowns.set(
        serverId,
        Date.now() + MCP_CONNECTION_ERROR_COOLDOWN_MS,
      );
    } else {
      this.failedConnectionCooldowns.delete(serverId);
    }
  }

  async refreshConnections(force: boolean) {
    this.abortController.abort();
    this.abortController = new AbortController();
    await Promise.race([
      new Promise((resolve) => {
        this.abortController.signal.addEventListener("abort", () => {
          resolve(undefined);
        });
      }),
      (async () => {
        const connections = Array.from(this.connections.values());
        const concurrency = force
          ? MAX_MCP_CONNECTION_REFRESH_CONCURRENCY
          : MAX_MCP_STARTUP_CONNECTION_REFRESH_CONCURRENCY;
        for (let index = 0; index < connections.length; index += concurrency) {
          if (this.abortController.signal.aborted) {
            return;
          }
          await Promise.allSettled(
            connections
              .slice(index, index + concurrency)
              .map(async (connection) => {
                await this.refreshConnectionWithCooldown(
                  connection,
                  force,
                  this.abortController.signal,
                );
              }),
          );
        }
        if (this.onConnectionsRefreshed) {
          this.onConnectionsRefreshed();
        }
      })(),
    ]);
  }

  getStatuses(): (MCPServerStatus & { client: Client })[] {
    return Array.from(this.connections.values()).map((connection) => ({
      ...connection.getStatus(),
      client: connection.client,
    }));
  }

  setStatus(serverId: string, status: MCPServerStatus["status"]) {
    this.connections.get(serverId)!.status = status;
  }

  async getPrompt(
    serverName: string,
    promptName: string,
    args: Record<string, string> = {},
  ) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(
        `Error getting prompt: MCP Connection ${serverName} not found`,
      );
    }
    return await connection.client.getPrompt({
      name: promptName,
      arguments: args,
    });
  }
}
