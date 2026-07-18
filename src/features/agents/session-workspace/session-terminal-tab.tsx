import { ProjectTerminal } from "../../terminals/project-terminal";
import { useI18n } from "../../../shared/i18n/i18n";

interface SessionTerminalTabProps {
  projectId: number;
  sessionId: number;
}

export function SessionTerminalTab({
  projectId,
  sessionId,
}: SessionTerminalTabProps) {
  const { messages } = useI18n();

  return (
    <section
      aria-label={messages.agentsFeature.sessionTerminal}
      className="session-terminal-tab"
    >
      <ProjectTerminal projectId={projectId} sessionId={sessionId} />
    </section>
  );
}
