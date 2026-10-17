import { useEffect, useMemo, useState } from "react";

import { TerminalSurface } from "../../terminals/terminal-surface";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";
import { subscribeAgentSessionTerminalOutput } from "../agent-terminal-events";
import {
  openCompletedReview,
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  restoreAgentSessionTerminal,
  subscribeAgentSessionTerminalOutput as subscribeAgentSessionTerminalOutputCommand,
  unsubscribeAgentSessionTerminalOutput,
  writeAgentSessionTerminal,
} from "../agent-session-commands";
import { filterCompletedReviewInput } from "./completed-review-input";

interface CompletedReviewTerminalProps {
  projectId: number;
  sessionId: number;
}

/**
 * 已完成 Issue 切离归档后的交互式 resume。
 * json 与 tui 都走这条终端，不回放尾部，也不显示结构化消息流。
 */
export function CompletedReviewTerminal({
  projectId,
  sessionId,
}: CompletedReviewTerminalProps) {
  return (
    <CompletedReviewTerminalSession
      key={`${projectId}:${sessionId}`}
      projectId={projectId}
      sessionId={sessionId}
    />
  );
}

function CompletedReviewTerminalSession({
  projectId,
  sessionId,
}: CompletedReviewTerminalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"opening" | "ready" | "failed">("opening");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void openCompletedReview({ projectId, sessionId })
      .then(() => {
        if (!cancelled) {
          setPhase("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setPhase("failed");
        setErrorMessage(getCommandErrorMessage(error, t));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId, t]);

  const transport = useMemo(
    () => ({
      readSnapshot: (maxBytes: number) =>
        readAgentSessionTerminal({ projectId, sessionId, maxBytes }),
      resize: (rows: number, cols: number) =>
        resizeAgentSessionTerminal({ projectId, sessionId, rows, cols }),
      restore: () => restoreAgentSessionTerminal({ projectId, sessionId }),
      setLiveSubscription: (active: boolean) =>
        active
          ? subscribeAgentSessionTerminalOutputCommand({ projectId, sessionId })
          : unsubscribeAgentSessionTerminalOutput({ projectId, sessionId }),
      subscribeOutput: (
        handler: (event: { sequence: number; data: string }) => void,
      ) =>
        subscribeAgentSessionTerminalOutput((event) => {
          if (event.projectId !== projectId || event.sessionId !== sessionId) {
            return;
          }
          handler({ sequence: event.sequence, data: event.data });
        }),
      write: (data: string) => {
        const allowed = filterCompletedReviewInput(data);
        if (!allowed) {
          return Promise.resolve();
        }
        return writeAgentSessionTerminal({
          projectId,
          sessionId,
          data: allowed,
        });
      },
    }),
    [projectId, sessionId],
  );

  if (phase === "failed") {
    return (
      <p className="agent-tui-session-shell__banner" role="alert">
        {errorMessage}
      </p>
    );
  }

  return (
    <div
      aria-label={t("agentsFeature.completedReviewTerminal")}
      className="agent-tui-session-shell"
      hidden={phase !== "ready"}
    >
      {phase === "opening" ? (
        <p className="agent-tui-session-shell__banner" role="status">
          {t("agentsFeature.completedReviewOpening")}
        </p>
      ) : null}
      <TerminalSurface
        ariaLabel={t("agentsFeature.completedReviewTerminal")}
        transport={transport}
        transportKey={`completed-review:${projectId}:${sessionId}`}
      />
    </div>
  );
}
