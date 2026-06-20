// 结构化消息流的卡片渲染层。
//
// 按 `MessageStreamEntry.kind` 分发到对应的子卡片组件。视觉遵循 DESIGN_GUIDE：
// 黑白灰优先、13px body、1px 边框、无阴影、状态不只靠颜色（Badge + 文字）。

import {
  AlertCircle,
  LoaderCircle,
  Terminal,
  ChevronDown,
  ExternalLink,
  FileEdit,
  FilePlus,
  FileSearch,
  GitBranch,
  ListChecks,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui";
import type {
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallStatus,
} from "../agent-stream-types";
import { AgentMarkdown } from "./agent-markdown";
import type { MessageStreamEntry } from "./message-stream-types";

interface AgentMessageCardsProps {
  entries: MessageStreamEntry[];
}

export function AgentMessageCards({ entries }: AgentMessageCardsProps) {
  return (
    <>
      {entries.map((entry) => (
        <MessageCard key={entry.id} entry={entry} />
      ))}
    </>
  );
}

function MessageCard({ entry }: { entry: MessageStreamEntry }) {
  const item = entry.item;
  switch (item.type) {
    case "user_message":
      return <UserMessageCard item={item} />;
    case "assistant_message":
      return <AssistantMessageCard item={item} />;
    case "reasoning":
      return <ReasoningCard item={item} />;
    case "tool_call":
      return <ToolCallCard item={item} />;
    case "todo":
      return <TodoCard item={item} />;
    case "error":
      return <ErrorCard item={item} />;
    case "compaction":
      return <CompactionCard item={item} />;
    default:
      return null;
  }
}

function UserMessageCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "user_message" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--user">
      <div className="agents-message__bubble agents-message__bubble--user">
        <p className="agents-message__text">{item.text}</p>
      </div>
    </article>
  );
}

function AssistantMessageCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "assistant_message" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--assistant">
      <div className="agents-message__bubble agents-message__bubble--assistant">
        <AgentMarkdown>{item.text}</AgentMarkdown>
      </div>
    </article>
  );
}

function ReasoningCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "reasoning" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--reasoning">
      <details className="agents-message__reasoning">
        <summary className="agents-message__reasoning-summary">
          <Sparkles aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>Thinking</span>
          <ChevronDown
            aria-hidden="true"
            size={13}
            strokeWidth={1.8}
            className="agents-message__summary-chevron"
          />
        </summary>
        <p className="agents-message__reasoning-text">{item.text}</p>
      </details>
    </article>
  );
}

function ToolCallCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "tool_call" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--tool">
      <div className="agents-message__tool">
        <div className="agents-message__tool-header">
          <span className="agents-message__tool-name">
            <ToolCallIcon detail={item.detail} />
            <span>{formatToolName(item.name, item.detail)}</span>
          </span>
          <ToolCallStatusBadge status={item.status} />
        </div>
        <ToolCallDetail detail={item.detail} />
        {item.error ? (
          <p className="agents-message__tool-error">{item.error}</p>
        ) : null}
      </div>
    </article>
  );
}

function ToolCallIcon({ detail }: { detail: ToolCallDetail }) {
  switch (detail.type) {
    case "shell":
      return <Terminal aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "read":
    case "search":
      return <FileSearch aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "edit":
      return <FileEdit aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "write":
      return <FilePlus aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "sub_agent":
      return <GitBranch aria-hidden="true" size={13} strokeWidth={1.8} />;
    default:
      return null;
  }
}

function ToolCallStatusBadge({ status }: { status: ToolCallStatus }) {
  if (status === "running") {
    return (
      <Badge variant="secondary" className="agents-message__tool-status">
        <LoaderCircle
          aria-hidden="true"
          size={11}
          strokeWidth={2}
          className="agents-message__spinner"
        />
        运行中
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="agents-message__tool-status">
        失败
      </Badge>
    );
  }
  if (status === "canceled") {
    return (
      <Badge variant="outline" className="agents-message__tool-status">
        已取消
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="agents-message__tool-status">
      完成
    </Badge>
  );
}

function ToolCallDetail({ detail }: { detail: ToolCallDetail }) {
  switch (detail.type) {
    case "shell":
      return (
        <div className="agents-message__tool-body">
          <code className="agents-message__command">{detail.command}</code>
          {detail.output || detail.exitCode != null ? (
            <details className="agents-message__tool-output">
              <summary className="agents-message__tool-output-summary">
                <span>Output</span>
                {detail.exitCode != null ? (
                  <span className="agents-message__exit-code">{`exit ${detail.exitCode}`}</span>
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  size={13}
                  strokeWidth={1.8}
                  className="agents-message__summary-chevron"
                />
              </summary>
              {detail.output ? (
                <pre className="agents-message__output">{detail.output}</pre>
              ) : null}
            </details>
          ) : null}
        </div>
      );
    case "read":
      return (
        <div className="agents-message__tool-body">
          <code className="agents-message__path">{detail.path}</code>
          {detail.content ? (
            <pre className="agents-message__output">{detail.content}</pre>
          ) : null}
        </div>
      );
    case "edit":
      return (
        <div className="agents-message__tool-body">
          <code className="agents-message__path">{detail.path}</code>
          {detail.diff ? (
            <pre className="agents-message__output agents-message__output--diff">
              {detail.diff}
            </pre>
          ) : null}
        </div>
      );
    case "write":
      return (
        <div className="agents-message__tool-body">
          <code className="agents-message__path">{detail.path}</code>
          {detail.content ? (
            <pre className="agents-message__output">{detail.content}</pre>
          ) : null}
        </div>
      );
    case "search":
      return (
        <div className="agents-message__tool-body">
          <details className="agents-message__tool-output">
            <summary className="agents-message__tool-output-summary">
              <span>{formatSearchSummary(detail)}</span>
              <ChevronDown
                aria-hidden="true"
                size={13}
                strokeWidth={1.8}
                className="agents-message__summary-chevron"
              />
            </summary>
            <div className="agents-message__search-details">
              <p className="agents-message__search-query">{detail.query}</p>
              {detail.matches.length > 0 ? (
                <ul className="agents-message__search-matches">
                  {detail.matches.map((match, index) => (
                    <li key={`${index}-${match}`}>
                      <SearchMatch match={match} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="agents-message__search-empty">没有返回匹配项</p>
              )}
            </div>
          </details>
        </div>
      );
    case "sub_agent":
      return (
        <div className="agents-message__tool-body">
          {detail.childSessionId ? (
            <p className="agents-message__sub-agent">{`子会话：${detail.childSessionId}`}</p>
          ) : (
            <p className="agents-message__sub-agent">子会话已启动</p>
          )}
        </div>
      );
    case "plan":
      return (
        <div className="agents-message__tool-body">
          <p className="agents-message__plan">{detail.text}</p>
        </div>
      );
    default:
      return (
        <div className="agents-message__tool-body">
          {detail.rawInput ? (
            <pre className="agents-message__output">{detail.rawInput}</pre>
          ) : null}
          {detail.rawOutput ? (
            <pre className="agents-message__output">{detail.rawOutput}</pre>
          ) : null}
        </div>
      );
  }
}

function SearchMatch({ match }: { match: string }) {
  const url = extractFirstUrl(match);
  if (!url) {
    return <code>{match}</code>;
  }
  return (
    <a
      className="agents-message__search-link"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <ExternalLink aria-hidden="true" size={12} strokeWidth={1.8} />
      <span>{match}</span>
    </a>
  );
}

function formatSearchSummary(
  detail: Extract<ToolCallDetail, { type: "search" }>,
): string {
  const count = detail.matches.length;
  if (count === 0) {
    return "查看搜索内容";
  }
  return `查看搜索内容和 ${count} 条结果`;
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match?.[0] ?? null;
}

function formatToolName(name: string, detail: ToolCallDetail): string {
  if (detail.type === "shell") {
    return "Shell";
  }
  if (detail.type === "edit") {
    return "Edit";
  }
  if (detail.type === "write") {
    return "Write";
  }
  if (detail.type === "read") {
    return "Read";
  }
  if (detail.type === "search") {
    return "Search";
  }
  if (detail.type === "plan") {
    return "Plan";
  }
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function TodoCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "todo" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--todo">
      <div className="agents-message__todo">
        <div className="agents-message__todo-header">
          <ListChecks aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>待办清单</span>
        </div>
        <ul className="agents-message__todo-list">
          {item.items.map((todo, index) => (
            <li
              key={`${index}-${todo.text}`}
              className={`agents-message__todo-item${
                todo.completed ? " agents-message__todo-item--done" : ""
              }`}
            >
              <span
                className="agents-message__todo-check"
                aria-hidden="true"
                aria-label={todo.completed ? "已完成" : "未完成"}
              >
                {todo.completed ? "✓" : "○"}
              </span>
              <span className="agents-message__todo-text">{todo.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ErrorCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "error" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--error">
      <div className="agents-message__error">
        <AlertCircle aria-hidden="true" size={13} strokeWidth={1.8} />
        <p>{item.message}</p>
      </div>
    </article>
  );
}

function CompactionCard({
  item: _item,
}: {
  item: Extract<AgentTimelineItem, { type: "compaction" }>;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--compaction">
      <p className="agents-message__compaction">上下文已压缩</p>
    </article>
  );
}
