export const SESSION_MONITOR_ENABLED_STORAGE_KEY =
  "redwhisk.sessionMonitor.enabled";

export function getInitialSessionMonitorEnabled(): boolean {
  return false;
}

export function setSessionMonitorEnabledPreference(isEnabled: boolean): void {
  try {
    window.localStorage.setItem(
      SESSION_MONITOR_ENABLED_STORAGE_KEY,
      String(isEnabled),
    );
  } catch {
    // Runtime state can still update when localStorage is unavailable.
  }
}
