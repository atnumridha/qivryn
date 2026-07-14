import { EventEmitter } from "events";

import { ToolCallRequest } from "./types.js";

export interface PermissionRequestResult {
  approved: boolean;
  remember?: boolean; // For future implementation - remember this decision
}

export class ToolPermissionManager extends EventEmitter {
  private pendingRequests = new Map<
    string,
    {
      toolCall: ToolCallRequest;
      resolve: (result: PermissionRequestResult) => void;
    }
  >();
  private readonly rememberedApprovals = new Set<string>();

  private requestCounter = 0;

  /**
   * Request permission for a tool call. Returns a promise that resolves
   * when the user approves or rejects the request.
   */
  async requestPermission(
    toolCall: ToolCallRequest,
  ): Promise<PermissionRequestResult> {
    if (this.rememberedApprovals.has(this.approvalScope(toolCall))) {
      return { approved: true, remember: true };
    }
    const requestId = `tool-request-${++this.requestCounter}`;

    return new Promise<PermissionRequestResult>((resolve) => {
      this.pendingRequests.set(requestId, {
        toolCall,
        resolve,
      });

      // Emit event for UI to handle
      this.emit("permissionRequested", {
        requestId,
        toolCall,
      });
    });
  }

  /**
   * Approve a pending permission request
   */
  approveRequest(requestId: string, remember = false): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      // Also try to emit for the new event-based system
      this.emit("permissionResponse", { requestId, approved: true });
      return false;
    }

    this.pendingRequests.delete(requestId);
    if (remember) {
      this.rememberedApprovals.add(this.approvalScope(request.toolCall));
    }
    request.resolve({ approved: true, remember });

    // Also emit for the new event-based system
    this.emit("permissionResponse", { requestId, approved: true });
    return true;
  }

  /**
   * Reject a pending permission request
   */
  rejectRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      // Also try to emit for the new event-based system
      this.emit("permissionResponse", { requestId, approved: false });
      return false;
    }

    this.pendingRequests.delete(requestId);
    request.resolve({ approved: false });

    // Also emit for the new event-based system
    this.emit("permissionResponse", { requestId, approved: false });
    return true;
  }

  /**
   * Get details of a pending request
   */
  getPendingRequest(requestId: string) {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Get all pending request IDs
   */
  getPendingRequestIds(): string[] {
    return Array.from(this.pendingRequests.keys());
  }

  rejectAllPending(): void {
    for (const requestId of this.getPendingRequestIds()) {
      this.rejectRequest(requestId);
    }
  }

  private approvalScope(toolCall: ToolCallRequest): string {
    const sanitize = (value: unknown, key = ""): unknown => {
      if (
        /^text$|password|passphrase|secret|token|api.?key|authorization|cookie|content|base64/i.test(
          key,
        )
      ) {
        return "[sensitive]";
      }
      if (Array.isArray(value)) return value.map((item) => sanitize(item));
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .filter(([entryKey]) => entryKey !== "toolCallId")
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([entryKey, entryValue]) => [
              entryKey,
              sanitize(entryValue, entryKey),
            ]),
        );
      }
      return value;
    };
    return `${toolCall.name}:${JSON.stringify(sanitize(toolCall.arguments))}`;
  }
}

// Global instance
export const toolPermissionManager = new ToolPermissionManager();
