import { useEffect } from "react";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { AgentSessionMonitorButton } from "./agent-session-monitor-button";
import { openMonitoredAgentSession } from "./session-monitor-commands";

interface SessionMonitorSurfaceProps {
  ownerWindowLabel: string;
  projectId: number;
}

export function SessionMonitorSurface({
  ownerWindowLabel,
  projectId,
}: SessionMonitorSurfaceProps) {
  useEffect(() => {
    document.body.classList.add("session-monitor-window");

    return () => {
      document.body.classList.remove("session-monitor-window");
    };
  }, []);

  return (
    <I18nProvider>
      <main className="session-monitor-surface">
        <AgentSessionMonitorButton
          mode="desktop"
          projectId={projectId}
          onViewSession={(sessionId) => {
            void openMonitoredAgentSession({
              ownerWindowLabel,
              projectId,
              sessionId,
            });
          }}
        />
      </main>
    </I18nProvider>
  );
}
