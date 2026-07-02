/**
 * Global configuration for tools system.
 * This stores command-line flags that affect tool availability.
 */

let betaUploadArtifactToolEnabled = false;
// Local subagents are a stable capability and are available on every surface.
// Keep the legacy flag setter for backwards compatibility with older scripts.
let betaSubagentToolEnabled = true;

export function setBetaUploadArtifactToolEnabled(enabled: boolean): void {
  betaUploadArtifactToolEnabled = enabled;
}

export function isBetaUploadArtifactToolEnabled(): boolean {
  return betaUploadArtifactToolEnabled;
}

export function setBetaSubagentToolEnabled(enabled: boolean): void {
  betaSubagentToolEnabled = enabled;
}

export function isBetaSubagentToolEnabled(): boolean {
  return betaSubagentToolEnabled;
}
