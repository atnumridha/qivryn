import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_RETRY_DELAYS_MS,
  nextAgentRuntimeRetryDelay,
} from "./agentRuntimeRetryPolicy";

describe("agent runtime recovery", () => {
  it("uses a bounded retry schedule", () => {
    expect(AGENT_RUNTIME_RETRY_DELAYS_MS).toEqual([1_000, 3_000, 7_000]);
    expect(nextAgentRuntimeRetryDelay(0)).toBe(1_000);
    expect(nextAgentRuntimeRetryDelay(2)).toBe(7_000);
    expect(nextAgentRuntimeRetryDelay(3)).toBeUndefined();
    expect(nextAgentRuntimeRetryDelay(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });
});
