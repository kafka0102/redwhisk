import { useEffect, useState } from "react";

import { AgentMarkdown } from "../message-stream/agent-markdown";
import { readAgentSessionTerminal } from "../agent-session-commands";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  prepareArchiveMarkdownForRender,
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

type ReviewCard =
  | { kind: "user"; text: string }
  | { kind: "conclusion"; text: string };

/** 连续 `›` 行是一张用户卡；其余行直到下一个 `›` 是一张结论卡。无标记则整篇 Markdown。 */
function splitReviewCards(markdown: string): ReviewCard[] | null {
  const lines = markdown.split("\n");
  if (!lines.some((line) => line.startsWith("›"))) {
    return null;
  }
  const cards: ReviewCard[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === "") {
      index += 1;
      continue;
    }
    if (lines[index]?.startsWith("›")) {
      const userLines: string[] = [];
      while (index < lines.length && lines[index]?.startsWith("›")) {
        const line = lines[index] ?? "";
        const body = line.startsWith("› ") ? line.slice(2) : line.slice(1);
        userLines.push(body);
        index += 1;
      }
      cards.push({ kind: "user", text: userLines.join("\n") });
      continue;
    }
    const conclusionLines: string[] = [];
    while (index < lines.length && !lines[index]?.startsWith("›")) {
      conclusionLines.push(lines[index] ?? "");
      index += 1;
    }
    while (conclusionLines[0] === "") {
      conclusionLines.shift();
    }
    while (conclusionLines[conclusionLines.length - 1] === "") {
      conclusionLines.pop();
    }
    if (conclusionLines.length > 0) {
      cards.push({ kind: "conclusion", text: conclusionLines.join("\n") });
    }
  }
  return cards;
}

function ReviewCards({ cards }: { cards: ReviewCard[] }) {
  return (
    <div className="agent-tui-archive-markdown__body">
      {cards.map((card, index) =>
        card.kind === "user" ? (
          <article
            key={`user-${index}`}
            className="agents-message__entry agents-message__entry--user"
          >
            <div className="agents-message__bubble agents-message__bubble--user">
              <p className="agents-message__text">{card.text}</p>
            </div>
          </article>
        ) : (
          <article
            key={`conclusion-${index}`}
            className="agents-message__entry agents-message__entry--assistant"
          >
            <div className="agents-message__bubble agents-message__bubble--assistant">
              <AgentMarkdown>{card.text}</AgentMarkdown>
            </div>
          </article>
        ),
      )}
    </div>
  );
}

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
        const markdown = prepareArchiveMarkdownForRender(result.snapshot);
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
        <ReadyArchive markdown={state.markdown} />
      ) : null}
    </div>
  );
}

function ReadyArchive({ markdown }: { markdown: string }) {
  const cards = splitReviewCards(markdown);
  if (cards == null) {
    return (
      <div className="agent-tui-archive-markdown__body">
        <AgentMarkdown>{markdown}</AgentMarkdown>
      </div>
    );
  }
  return <ReviewCards cards={cards} />;
}
