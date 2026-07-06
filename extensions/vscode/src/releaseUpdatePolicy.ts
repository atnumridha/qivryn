export const RELEASE_UPDATE_RETRY_DELAYS_MS = [1_000, 3_000, 7_000] as const;

export function nextReleaseUpdateRetryDelay(
  attempt: number,
): number | undefined {
  return RELEASE_UPDATE_RETRY_DELAYS_MS[attempt];
}

export function releaseVersionFromTag(tag: string): string | undefined {
  const match = /^v?(\d+\.\d+\.\d+)(?:-qivryn-ide)?$/.exec(tag.trim());
  return match?.[1];
}

export function isNewerRelease(
  currentVersion: string,
  candidateVersion: string,
): boolean {
  const current = parseVersion(currentVersion);
  const candidate = parseVersion(candidateVersion);
  if (!current || !candidate) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] > current[index];
    }
  }
  return false;
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
