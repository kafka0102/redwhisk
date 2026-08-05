import { useEffect, useState } from "react";

import { AgentMarkdown } from "../message-stream/agent-markdown";
import { readAgentSessionTerminal } from "../agent-session-commands";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  prepareTuiArchiveMarkdownForRender,
  TUI_ARCHIVE_READ_MAX_BYTES,
} from "./agent-tui-archive-path";

interface AgentTuiArchiveMarkdownViewProps {
  projectId: number;
  sessionId: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; markdown: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/**
 * TUI Issue 完成归档回看：读磁盘快照并用 AgentMarkdown 渲染（对齐 JSON 富文本）。
 * 不挂 xterm，不自动 resume。
 */
export function AgentTuiArchiveMarkdownView({
  projectId,
  sessionId,
}: AgentTuiArchiveMarkdownViewProps) {
  const { messages } = useI18n();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [trackedKey, setTrackedKey] = useState(
    () => `${projectId}:${sessionId}`,
  );
  const sessionKey = `${projectId}:${sessionId}`;
  // session 切换时在 render 阶段同步重置（避免 effect 内同步 setState）。
  if (trackedKey !== sessionKey) {
    setTrackedKey(sessionKey);
    setState({ kind: "loading" });
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await readAgentSessionTerminal({
          projectId,
          sessionId,
          maxBytes: TUI_ARCHIVE_READ_MAX_BYTES,
        });
        if (cancelled) {
          return;
        }
        const markdown = prepareTuiArchiveMarkdownForRender(result.snapshot);
        if (markdown.trim() === "") {
          setState({ kind: "empty" });
          return;
        }
        setState({ kind: "ready", markdown });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : messages.agentsFeature.tuiArchiveLoadFailed;
        setState({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages.agentsFeature.tuiArchiveLoadFailed, projectId, sessionId]);

  return (
    <div
      className="agent-tui-archive-markdown"
      aria-label={messages.agentsFeature.tuiArchiveView}
    >
      {state.kind === "loading" ? (
        <p className="agent-tui-archive-markdown__status" role="status">
          {messages.agentsFeature.tuiArchiveLoading}
        </p>
      ) : null}
      {state.kind === "empty" ? (
        <p className="agent-tui-archive-markdown__status" role="status">
          {messages.agentsFeature.tuiArchiveEmpty}
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="agent-tui-archive-markdown__status" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ready" ? (
        <div className="agent-tui-archive-markdown__body">
          <AgentMarkdown>{state.markdown}</AgentMarkdown>
        </div>
      ) : null}
    </div>
  );
}
