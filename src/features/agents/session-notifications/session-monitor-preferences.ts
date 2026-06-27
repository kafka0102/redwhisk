export const SESSION_MONITOR_ENABLED_STORAGE_KEY =
  "redwhisk.sessionMonitor.enabled";

export function getInitialSessionMonitorEnabled(): boolean {
  try {
    const storedValue = window.localStorage.getItem(
      SESSION_MONITOR_ENABLED_STORAGE_KEY,
    );
    return storedValue === null ? true : storedValue === "true";
  } catch {
    return true;
  }
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
