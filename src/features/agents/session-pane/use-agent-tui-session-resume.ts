import { useCallback, useEffect, useRef, useState } from "react";

import {
  listAgentModels,
  readAgentSessionTerminal,
  resumeAgentSession,
  type AgentSessionStatus,
  type IssueStatus,
} from "../agent-session-commands";
import {
  getCommandErrorMessage,
  type CommandError,
} from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  getTuiResumeErrorReason,
  isTuiResumeRetryableReason,
  shouldAutoResumeTuiSession,
} from "./agent-tui-session-resume";
import { SAFE_DEFAULT_CAPABILITIES } from "../composer/use-agent-models";

export type TuiResumeUiPhase = "idle" | "resuming" | "failed" | "succeeded";

export interface UseAgentTuiSessionResumeArgs {
  projectId: number;
  sessionId: number;
  sessionStatus?: AgentSessionStatus;
  issueStatus?: IssueStatus | null;
  /** 是否为当前选中 session（实例池 hidden 时为 false，不自动 resume）。 */
  isActive?: boolean;
  /** 为 false 时完全不探测 / 不 resume（Issue 只读路径不挂此 hook）。 */
  autoResumeEnabled?: boolean;
}

export interface UseAgentTuiSessionResumeResult {
  phase: TuiResumeUiPhase;
  errorMessage: string | null;
  canRetry: boolean;
  /** remount TerminalSurface 的 key 后缀，成功后续接后递增。 */
  surfaceEpoch: number;
  retry: () => void;
}

/**
 * Agents TUI 主区自动续接：PTY inactive 且 supportsTuiResume 时 resume 一次；
 * 进行中显示 loading；失败按 reason 白名单提供手动重试。
 */
export function useAgentTuiSessionResume({
  projectId,
  sessionId,
  sessionStatus,
  issueStatus = null,
  isActive = true,
  autoResumeEnabled = true,
}: UseAgentTuiSessionResumeArgs): UseAgentTuiSessionResumeResult {
  const { t } = useI18n();
  const [phase, setPhase] = useState<TuiResumeUiPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | undefined>(undefined);
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);
  const [trackedSessionKey, setTrackedSessionKey] = useState(
    () => `${projectId}:${sessionId}`,
  );
  const autoAttemptedKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);

  const sessionKey = `${projectId}:${sessionId}`;
  // session 切换时在 render 阶段同步重置 UI 态（避免 effect 内同步 setState）。
  if (trackedSessionKey !== sessionKey) {
    setTrackedSessionKey(sessionKey);
    setPhase("idle");
    setErrorMessage(null);
    setErrorReason(undefined);
  }

  const runResume = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    const keyAtStart = `${projectId}:${sessionId}`;
    setPhase("resuming");
    setErrorMessage(null);
    setErrorReason(undefined);

    try {
      await resumeAgentSession({ projectId, sessionId });
      if (disposedRef.current || keyAtStart !== `${projectId}:${sessionId}`) {
        return;
      }
      setPhase("succeeded");
      setSurfaceEpoch((value) => value + 1);
    } catch (error) {
      if (disposedRef.current || keyAtStart !== `${projectId}:${sessionId}`) {
        return;
      }
      const reason = getTuiResumeErrorReason(error);
      setErrorReason(reason);
      setErrorMessage(getCommandErrorMessage(error as CommandError, t));
      setPhase("failed");
    } finally {
      inFlightRef.current = false;
    }
  }, [projectId, sessionId, t]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!autoResumeEnabled || !isActive) {
      return;
    }
    if (autoAttemptedKeyRef.current === sessionKey) {
      return;
    }

    let cancelled = false;

    async function maybeAutoResume(): Promise<void> {
      try {
        const modelsResult = await listAgentModels({ projectId, sessionId });
        if (cancelled || disposedRef.current) {
          return;
        }
        const supportsTuiResume =
          modelsResult.capabilities?.supportsTuiResume ??
          SAFE_DEFAULT_CAPABILITIES.supportsTuiResume;

        const snapshot = await readAgentSessionTerminal({
          projectId,
          sessionId,
          maxBytes: 1,
        });
        if (cancelled || disposedRef.current) {
          return;
        }
        const isPtyActive = snapshot.isActive;

        if (
          !shouldAutoResumeTuiSession({
            isActive,
            sessionStatus,
            issueStatus,
            supportsTuiResume,
            isPtyActive,
          })
        ) {
          return;
        }

        autoAttemptedKeyRef.current = sessionKey;
        await runResume();
      } catch {
        // 探测失败：不标记 auto 已尝试，避免能力/PTY 短暂失败后永久跳过。
      }
    }

    void maybeAutoResume();

    return () => {
      cancelled = true;
    };
  }, [
    autoResumeEnabled,
    isActive,
    issueStatus,
    projectId,
    runResume,
    sessionKey,
    sessionId,
    sessionStatus,
  ]);

  const retry = useCallback(() => {
    if (phase === "resuming") {
      return;
    }
    void runResume();
  }, [phase, runResume]);

  return {
    phase,
    errorMessage,
    canRetry: phase === "failed" && isTuiResumeRetryableReason(errorReason),
    surfaceEpoch,
    retry,
  };
}
