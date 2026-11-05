import { useCallback, useEffect, useRef, useState } from "react";

import { nextAutoSyncDelaySeconds } from "./issue-auto-sync";

export type AutoSyncResult = "failed" | "skipped" | "synced";

export function usePageVisible(): boolean {
  const [isVisible, setIsVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const sync = () => {
      setIsVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return isVisible;
}

export function useIssueAutoSync({
  isActive,
  intervalSeconds,
  runSync,
}: {
  isActive: boolean;
  intervalSeconds: number;
  runSync: () => Promise<AutoSyncResult>;
}): {
  noteManualResult: (result: AutoSyncResult) => void;
} {
  const failuresRef = useRef(0);
  const runSyncRef = useRef(runSync);
  const intervalRef = useRef(intervalSeconds);
  const rearmRef = useRef<(delaySeconds: number) => void>(() => undefined);

  useEffect(() => {
    runSyncRef.current = runSync;
    intervalRef.current = intervalSeconds;
    if (!isActive) {
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const arm = (delaySeconds: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void tick();
      }, delaySeconds * 1000);
    };
    rearmRef.current = arm;

    const tick = async () => {
      const result = await runSyncRef.current();
      if (cancelled) {
        return;
      }
      if (result === "failed") {
        failuresRef.current += 1;
      } else if (result === "synced") {
        failuresRef.current = 0;
      }
      arm(nextAutoSyncDelaySeconds(intervalRef.current, failuresRef.current));
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      rearmRef.current = () => undefined;
    };
  }, [isActive, intervalSeconds, runSync]);

  const noteManualResult = useCallback((result: AutoSyncResult) => {
    if (result !== "synced") {
      return;
    }
    failuresRef.current = 0;
    rearmRef.current(nextAutoSyncDelaySeconds(intervalRef.current, 0));
  }, []);

  return { noteManualResult };
}
