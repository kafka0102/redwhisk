// 结构化消息流的卡片渲染层。
//
// 按 `MessageStreamEntry.kind` 分发到对应的子卡片组件。视觉遵循 DESIGN_GUIDE：
// 黑白灰优先、13px body、1px 边框、无阴影、状态不只靠颜色（Badge + 文字）。

import {
  AlertCircle,
  LoaderCircle,
  Terminal,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileEdit,
  FilePlus,
  FileSearch,
  GitBranch,
  ListChecks,
  Search,
  Sparkles,
} from "lucide-react";
import { memo, useState } from "react";

import { Badge } from "@/components/ui";
import { useI18n } from "../../../shared/i18n/i18n";
import type {
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallStatus,
} from "../agent-stream-types";
import { AgentMarkdown } from "./agent-markdown";
import { HighlightedDiffBlock } from "./highlighted-diff-block";
import type { MessageStreamEntry } from "./message-stream-types";

interface AgentMessageCardsProps {
  entries: MessageStreamEntry[];
}

const MAX_TOOL_DETAIL_TEXT_LENGTH = 20_000;

// memo 化：entries 引用不变时跳过整棵卡片树的 map + reconciliation。
// 实例池模式下 sessions 列表刷新不再触发未变 session 的卡片重渲染。
export const AgentMessageCards = memo(function AgentMessageCards({
  entries,
}: AgentMessageCardsProps) {
  return (
    <>
      {entries.map((entry) => (
        <MessageCard key={entry.id} entry={entry} />
      ))}
    </>
  );
});

const MessageCard = memo(function MessageCard({
  entry,
}: {
  entry: MessageStreamEntry;
}) {
  const { messages } = useI18n();
  const item = entry.item;
  switch (item.type) {
    case "user_message":
      return <UserMessageCard item={item} />;
    case "assistant_message":
      return <AssistantMessageCard item={item} />;
    case "reasoning":
      return (
        <ReasoningCard
          item={item}
          thinkingLabel={messages.agentsFeature.reasoningTitle}
          completedLabel={messages.agentsFeature.reasoningDuration}
        />
      );
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
});

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
  thinkingLabel,
  completedLabel,
}: {
  item: Extract<AgentTimelineItem, { type: "reasoning" }>;
  thinkingLabel: string;
  /** 已完成 reasoning 的时长文案 formatter：入参为秒。 */
  completedLabel: (seconds: number) => string;
}) {
  // durationMs 存在表示 reasoning 块已结束（后端 force flush 时填充）。
  // 此时标题展示「思考过程（共进行了 X 秒）」；否则回退到「正在思考…」。
  const label =
    item.durationMs != null
      ? completedLabel(Math.max(1, Math.round(item.durationMs / 1000)))
      : thinkingLabel;
  return (
    <article className="agents-message__entry agents-message__entry--reasoning">
      <details className="agents-message__reasoning">
        <summary className="agents-message__reasoning-summary">
          <Sparkles aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>{label}</span>
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
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const presentation = buildToolCallPresentation(item.name, item.detail);
  const hasExpandableDetail = hasToolCallDetail(item.detail);
  return (
    <article className="agents-message__entry agents-message__entry--tool">
      <div
        className={`agents-message__tool${
          hasExpandableDetail ? " agents-message__tool--expandable" : ""
        }`}
      >
        {hasExpandableDetail ? (
          <details className="agents-message__tool-details" open={isDetailOpen}>
            <summary
              className="agents-message__tool-header"
              onClick={(event) => {
                event.preventDefault();
                setIsDetailOpen((current) => !current);
              }}
            >
              <ToolCallHeader
                detail={item.detail}
                presentation={presentation}
                status={item.status}
                isExpandable
              />
            </summary>
            {isDetailOpen ? <ToolCallDetail detail={item.detail} /> : null}
          </details>
        ) : (
          <>
            <div className="agents-message__tool-header">
              <ToolCallHeader
                detail={item.detail}
                presentation={presentation}
                status={item.status}
                isExpandable={false}
              />
            </div>
            <ToolCallDetail detail={item.detail} />
          </>
        )}
        {item.error ? (
          <p className="agents-message__tool-error">{item.error}</p>
        ) : null}
      </div>
    </article>
  );
}

function ToolCallHeader({
  detail,
  presentation,
  status,
  isExpandable,
}: {
  detail: ToolCallDetail;
  presentation: ToolCallPresentation;
  status: ToolCallStatus;
  isExpandable: boolean;
}) {
  return (
    <>
      <span className="agents-message__tool-name">
        <span className="agents-message__tool-icon" aria-hidden="true">
          <span className="agents-message__tool-type-icon">
            <ToolCallIcon detail={detail} />
          </span>
          {isExpandable ? (
            <ChevronRight
              aria-hidden="true"
              size={13}
              strokeWidth={1.8}
              className="agents-message__tool-expand-icon"
            />
          ) : null}
        </span>
        <span className="agents-message__tool-display-name">
          {presentation.displayName}
        </span>
        {presentation.summary ? (
          <span className="agents-message__tool-summary">
            {presentation.summary}
          </span>
        ) : null}
      </span>
      <ToolCallStatusBadge status={status} />
    </>
  );
}

function ToolCallIcon({ detail }: { detail: ToolCallDetail }) {
  switch (detail.type) {
    case "shell":
      return <Terminal aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "read":
      return <FileSearch aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "search":
      return <Search aria-hidden="true" size={13} strokeWidth={1.8} />;
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
  const { messages } = useI18n();
  if (status === "completed") {
    return null;
  }
  if (status === "running") {
    return (
      <Badge variant="secondary" className="agents-message__tool-status">
        <LoaderCircle
          aria-hidden="true"
          size={11}
          strokeWidth={2}
          className="agents-message__spinner"
        />
        {messages.agentsFeature.toolRunning}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="agents-message__tool-status">
        {messages.agentsFeature.toolFailed}
      </Badge>
    );
  }
  if (status === "canceled") {
    return (
      <Badge variant="outline" className="agents-message__tool-status">
        {messages.agentsFeature.toolCanceled}
      </Badge>
    );
  }
}

function ToolCallDetail({ detail }: { detail: ToolCallDetail }) {
  const { messages } = useI18n();
  switch (detail.type) {
    case "shell": {
      const shellOutput = truncateToolDetailText(detail.output);
      return (
        <div className="agents-message__tool-body">
          {detail.output || detail.exitCode != null ? (
            <div className="agents-message__tool-output">
              {detail.exitCode != null ? (
                <span className="agents-message__exit-code">
                  {messages.agentsFeature.exitCode(detail.exitCode)}
                </span>
              ) : null}
              <code className="agents-message__command agents-message__command--details">
                {detail.command}
              </code>
              {shellOutput ? (
                <>
                  <pre className="agents-message__output">
                    {shellOutput.text}
                  </pre>
                  {shellOutput.isTruncated ? (
                    <p className="agents-message__truncated" role="status">
                      {messages.agentsFeature.toolOutputTruncated(
                        shellOutput.visibleCharacters,
                        shellOutput.totalCharacters,
                      )}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "read": {
      const readContent = truncateToolDetailText(detail.content);
      return (
        <div className="agents-message__tool-body">
          {readContent ? (
            <div className="agents-message__tool-output">
              <code className="agents-message__path agents-message__path--details">
                {detail.path}
              </code>
              <pre className="agents-message__output">{readContent.text}</pre>
              {readContent.isTruncated ? (
                <p className="agents-message__truncated" role="status">
                  {messages.agentsFeature.toolOutputTruncated(
                    readContent.visibleCharacters,
                    readContent.totalCharacters,
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "edit": {
      const editDiff = truncateToolDetailText(detail.diff);
      return (
        <div className="agents-message__tool-body">
          {editDiff ? (
            <div className="agents-message__tool-output">
              <code className="agents-message__path agents-message__path--details">
                {detail.path}
              </code>
              <HighlightedDiffBlock diff={editDiff.text} path={detail.path} />
              {editDiff.isTruncated ? (
                <p className="agents-message__truncated" role="status">
                  {messages.agentsFeature.toolOutputTruncated(
                    editDiff.visibleCharacters,
                    editDiff.totalCharacters,
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "write": {
      const writeContent = truncateToolDetailText(detail.content);
      return (
        <div className="agents-message__tool-body">
          {writeContent ? (
            <div className="agents-message__tool-output">
              <code className="agents-message__path agents-message__path--details">
                {detail.path}
              </code>
              <pre className="agents-message__output">{writeContent.text}</pre>
              {writeContent.isTruncated ? (
                <p className="agents-message__truncated" role="status">
                  {messages.agentsFeature.toolOutputTruncated(
                    writeContent.visibleCharacters,
                    writeContent.totalCharacters,
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "search":
      return (
        <div className="agents-message__tool-body">
          <div className="agents-message__tool-output">
            <div className="agents-message__search-details">
              <div className="agents-message__detail-row">
                <span className="agents-message__detail-label">
                  {messages.agentsFeature.query}
                </span>
                <code className="agents-message__search-query">
                  {detail.query}
                </code>
              </div>
              <div className="agents-message__detail-row">
                <span className="agents-message__detail-label">
                  {messages.agentsFeature.mode}
                </span>
                <code className="agents-message__search-query">
                  {formatSearchMode(detail.mode)}
                </code>
              </div>
              {detail.matches.length > 0 ? (
                <ul className="agents-message__search-matches">
                  {detail.matches.map((match, index) => (
                    <li key={`${index}-${match}`}>
                      <SearchMatch match={match} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="agents-message__search-empty">
                  {messages.agentsFeature.noSearchMatches}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    case "sub_agent":
      return (
        <div className="agents-message__tool-body">
          {detail.childSessionId ? (
            <p className="agents-message__sub-agent">
              {messages.agentsFeature.subSession(detail.childSessionId)}
            </p>
          ) : (
            <p className="agents-message__sub-agent">
              {messages.agentsFeature.subSessionStarted}
            </p>
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
          {detail.rawInput || detail.rawOutput ? (
            <div className="agents-message__tool-output">
              {detail.rawInput ? (
                <pre className="agents-message__output">{detail.rawInput}</pre>
              ) : null}
              {detail.rawOutput ? (
                <pre className="agents-message__output">{detail.rawOutput}</pre>
              ) : null}
            </div>
          ) : null}
        </div>
      );
  }
}

function hasToolCallDetail(detail: ToolCallDetail): boolean {
  switch (detail.type) {
    case "shell":
      return Boolean(detail.output) || detail.exitCode != null;
    case "read":
      return Boolean(detail.content);
    case "edit":
      return Boolean(detail.diff);
    case "write":
      return Boolean(detail.content);
    case "search":
      return true;
    case "unknown":
      return Boolean(detail.rawInput || detail.rawOutput);
    default:
      return false;
  }
}

function truncateToolDetailText(text: string | null | undefined): {
  text: string;
  isTruncated: boolean;
  visibleCharacters: number;
  totalCharacters: number;
} | null {
  if (!text) {
    return null;
  }
  if (text.length <= MAX_TOOL_DETAIL_TEXT_LENGTH) {
    return {
      text,
      isTruncated: false,
      visibleCharacters: text.length,
      totalCharacters: text.length,
    };
  }
  return {
    text: text.slice(0, MAX_TOOL_DETAIL_TEXT_LENGTH),
    isTruncated: true,
    visibleCharacters: MAX_TOOL_DETAIL_TEXT_LENGTH,
    totalCharacters: text.length,
  };
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

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match?.[0] ?? null;
}

interface ToolCallPresentation {
  displayName: string;
  summary?: string;
}

function buildToolCallPresentation(
  name: string,
  detail: ToolCallDetail,
): ToolCallPresentation {
  switch (detail.type) {
    case "shell":
      return { displayName: "Shell", summary: detail.command };
    case "edit":
      return { displayName: "Edit", summary: detail.path };
    case "write":
      return { displayName: "Write", summary: detail.path };
    case "read":
      return { displayName: "Read", summary: detail.path };
    case "search":
      return { displayName: "Search", summary: detail.query };
    case "sub_agent":
      return {
        displayName: "Task",
        summary: detail.childSessionId
          ? `子会话：${detail.childSessionId}`
          : undefined,
      };
    case "plan":
      return { displayName: "Plan" };
    case "unknown":
      return buildUnknownToolCallPresentation(name, detail);
    default:
      return { displayName: formatToolName(name) };
  }
}

function buildUnknownToolCallPresentation(
  name: string,
  detail: Extract<ToolCallDetail, { type: "unknown" }>,
): ToolCallPresentation {
  const displayName = formatToolName(name);
  if (!isWebSearchName(name)) {
    return { displayName };
  }
  const rawQuery = extractUnknownSearchQuery(detail.rawInput);
  const rawOutputQuery = extractUnknownSearchQuery(detail.rawOutput);
  return {
    displayName: "Search",
    summary: rawQuery ?? rawOutputQuery,
  };
}

function isWebSearchName(name: string): boolean {
  const normalized = name.replace(/[\s_-]+/g, "").toLowerCase();
  return normalized === "websearch" || normalized === "websearchtoolcall";
}

function extractUnknownSearchQuery(
  raw: string | undefined,
): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return findQueryInUnknown(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function findQueryInUnknown(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const directQuery = readString(value.query);
  if (directQuery) {
    return directQuery;
  }
  return (
    findQueryInUnknown(value.input) ??
    findQueryInUnknown(value.action) ??
    findQueryInUnknown(value.output)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function formatToolName(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSearchMode(
  mode: Extract<ToolCallDetail, { type: "search" }>["mode"],
) {
  if (mode === "files_with_matches") {
    return "files with matches";
  }
  return mode;
}

function TodoCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "todo" }>;
}) {
  const { messages } = useI18n();
  return (
    <article className="agents-message__entry agents-message__entry--todo">
      <div className="agents-message__todo">
        <div className="agents-message__todo-header">
          <ListChecks aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>{messages.agentsFeature.todoList}</span>
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
  const { messages } = useI18n();
  return (
    <article className="agents-message__entry agents-message__entry--compaction">
      <p className="agents-message__compaction">
        {messages.agentsFeature.contextCompacted}
      </p>
    </article>
  );
}
