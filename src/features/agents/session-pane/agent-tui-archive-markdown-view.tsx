import { useEffect, useState } from "react";

import { AgentMarkdown } from "../message-stream/agent-markdown";
import { readAgentSessionTerminal } from "../agent-session-commands";
import { ExpandableText } from "../expandable-text";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  jsonArchiveReviewCards,
  prepareTuiArchiveMarkdownForRender,
  TUI_ARCHIVE_READ_MAX_BYTES,
  type JsonArchiveReviewCard,
} from "./agent-tui-archive-path";

interface AgentTuiArchiveMarkdownViewProps {
  projectId: number;
  sessionId: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; markdown: string }
  | { kind: "cards"; cards: JsonArchiveReviewCard[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

type ReviewCard = JsonArchiveReviewCard;

const ARCHIVE_USER_MESSAGE_MAX_LINES = 5;

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
      cards.push({ kind: "assistant", text: conclusionLines.join("\n") });
    }
  }
  return cards;
}

function ReviewCards({ cards }: { cards: ReviewCard[] }) {
  return (
    <div className="agent-tui-archive-markdown__body">
      {cards.map((card, index) => (
        <ReviewCardView key={`${card.kind}-${index}`} card={card} />
      ))}
    </div>
  );
}

function ReviewCardView({ card }: { card: ReviewCard }) {
  const { messages } = useI18n();
  if (card.kind === "user") {
    return (
      <article className="agents-message__entry agents-message__entry--user">
        <div className="agents-message__bubble agents-message__bubble--user">
          <ExpandableText
            className="agents-message__text"
            text={card.text}
            maxLines={ARCHIVE_USER_MESSAGE_MAX_LINES}
            expandLabel={messages.agentsFeature.expandUserMessage}
            collapseLabel={messages.agentsFeature.collapseUserMessage}
          />
        </div>
      </article>
    );
  }
  if (card.kind === "error") {
    return (
      <article className="agents-message__entry agents-message__entry--error">
        <div className="agents-message__error">
          <p>{card.text}</p>
        </div>
      </article>
    );
  }
  return (
    <article className="agents-message__entry agents-message__entry--assistant">
      <div className="agents-message__bubble agents-message__bubble--assistant">
        <AgentMarkdown>{card.text}</AgentMarkdown>
      </div>
    </article>
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
        const jsonCards = jsonArchiveReviewCards(result.snapshot);
        if (jsonCards != null) {
          if (jsonCards.length === 0) {
            setState({ kind: "empty" });
            return;
          }
          setState({ kind: "cards", cards: jsonCards });
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
      {state.kind === "cards" ? <ReviewCards cards={state.cards} /> : null}
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
