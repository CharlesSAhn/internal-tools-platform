export type EvaluableFlagState = {
  flagKey: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUserIds: string[];
};

/** FNV-1a: stable across processes and runs, which a JS string hash needs to be. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function bucketOf(flagKey: string, userId: string): number {
  return hash(flagKey + userId) % 100;
}

export function isEnabledFor(flagState: EvaluableFlagState, userId: string): boolean {
  if (!flagState.enabled) return false;
  if (flagState.targetUserIds.includes(userId)) return true;
  return bucketOf(flagState.flagKey, userId) < flagState.rolloutPercentage;
}
