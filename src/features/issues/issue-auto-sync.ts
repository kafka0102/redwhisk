export const AUTO_SYNC_DELAY_CAP_SECONDS = 900;

export function nextAutoSyncDelaySeconds(
  intervalSeconds: number,
  consecutiveFailures: number,
): number {
  const interval = Math.max(1, Math.trunc(intervalSeconds));
  if (consecutiveFailures <= 0) {
    return interval;
  }
  let delay = interval;
  for (let index = 0; index < consecutiveFailures; index += 1) {
    delay = Math.min(delay * 2, AUTO_SYNC_DELAY_CAP_SECONDS);
  }
  return delay;
}
