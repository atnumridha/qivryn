export const AGENT_RUNTIME_RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export function nextAgentRuntimeRetryDelay(
  attempt: number,
): number | undefined {
  return AGENT_RUNTIME_RETRY_DELAYS_MS[attempt];
}
