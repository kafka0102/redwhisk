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
import { ExpandableText } from "../expandable-text";
import { AgentMarkdown } from "./agent-markdown";
import type { MessageStreamEntry } from "./message-stream-types";
import type { SessionFileLinks } from "./session-file-links";
import { ToolCallDetailView } from "./tool-call-detail";
import {
  buildToolCallPresentation,
  hasToolCallDetail,
  type ToolCallPresentation,
} from "./tool-call-presentation";
import { extractTaskUpdateInfo } from "./unknown-tool-payload";

interface AgentMessageCardsProps {
  entries: MessageStreamEntry[];
  /** 当前轮次仍在跑。为 false 时，没有时长的思考不再显示「正在思考」。 */
  reasoningInProgress?: boolean;
  expandedEntryIds?: readonly string[];
  entryLoadErrors?: Readonly<Record<string, string>>;
  onEntryExpandedChange?: (entryId: string, expanded: boolean) => void;
  /** 本地文件链接能力；`undefined` 表示本条流未接侧栏（路径只显示文本）。 */
  sessionFileLinks: SessionFileLinks | undefined;
}

// 用户消息可能是一次粘贴的长代码，折叠行数限制避免单条消息占据多个屏幕。
const USER_MESSAGE_MAX_LINES = 5;

// memo 化：entries 引用不变时跳过整棵卡片树的 map + reconciliation。
// 实例池模式下 sessions 列表刷新不再触发未变 session 的卡片重渲染。
export const AgentMessageCards = memo(function AgentMessageCards({
  entries,
  reasoningInProgress = false,
  expandedEntryIds = [],
  entryLoadErrors = {},
  onEntryExpandedChange,
  sessionFileLinks,
}: AgentMessageCardsProps) {
  return (
    <>
      {entries.map((entry) => (
        <MessageCard
          key={entry.id}
          entry={entry}
          reasoningInProgress={reasoningInProgress}
          isDetailOpen={expandedEntryIds.includes(entry.id)}
          loadError={entryLoadErrors[entry.id]}
          onEntryExpandedChange={onEntryExpandedChange}
          sessionFileLinks={sessionFileLinks}
        />
      ))}
    </>
  );
});

const MessageCard = memo(function MessageCard({
  entry,
  reasoningInProgress,
  isDetailOpen,
  loadError,
  onEntryExpandedChange,
  sessionFileLinks,
}: {
  entry: MessageStreamEntry;
  reasoningInProgress: boolean;
  isDetailOpen: boolean;
  loadError?: string;
  onEntryExpandedChange?: (entryId: string, expanded: boolean) => void;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const { messages } = useI18n();
  const item = entry.item;
  switch (item.type) {
    case "user_message":
      return <UserMessageCard item={item} />;
    case "assistant_message":
      return (
        <AssistantMessageCard item={item} sessionFileLinks={sessionFileLinks} />
      );
    case "reasoning":
      return (
        <ReasoningCard
          item={item}
          inProgress={reasoningInProgress}
          thinkingLabel={messages.agentsFeature.reasoningTitle}
          settledLabel={messages.agentsFeature.reasoningSettled}
          completedLabel={messages.agentsFeature.reasoningDuration}
        />
      );
    case "tool_call":
      return (
        <ToolCallCard
          item={item}
          entryId={entry.id}
          logOffset={entry.logOffset}
          isDetailOpen={isDetailOpen}
          loadError={loadError}
          onEntryExpandedChange={onEntryExpandedChange}
          sessionFileLinks={sessionFileLinks}
        />
      );
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
  const { messages } = useI18n();
  return (
    <article className="agents-message__entry agents-message__entry--user">
      <div className="agents-message__bubble agents-message__bubble--user">
        <ExpandableText
          className="agents-message__text"
          text={item.text}
          maxLines={USER_MESSAGE_MAX_LINES}
          expandLabel={messages.agentsFeature.expandUserMessage}
          collapseLabel={messages.agentsFeature.collapseUserMessage}
        />
      </div>
    </article>
  );
}

function AssistantMessageCard({
  item,
  sessionFileLinks,
}: {
  item: Extract<AgentTimelineItem, { type: "assistant_message" }>;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  return (
    <article className="agents-message__entry agents-message__entry--assistant">
      <div className="agents-message__bubble agents-message__bubble--assistant">
        <AgentMarkdown sessionFileLinks={sessionFileLinks}>
          {item.text}
        </AgentMarkdown>
      </div>
    </article>
  );
}

function ReasoningCard({
  item,
  inProgress,
  thinkingLabel,
  settledLabel,
  completedLabel,
}: {
  item: Extract<AgentTimelineItem, { type: "reasoning" }>;
  inProgress: boolean;
  thinkingLabel: string;
  settledLabel: string;
  /** 已完成 reasoning 的时长文案 formatter：入参为秒。 */
  completedLabel: (seconds: number) => string;
}) {
  // durationMs 表示这块思考已经结束。没有时长时，只有轮次仍在跑才显示
  // 「正在思考…」；轮次结束后（例如正在等用户回复）改为「思考过程」。
  const label =
    item.durationMs != null
      ? completedLabel(Math.max(1, Math.round(item.durationMs / 1000)))
      : inProgress
        ? thinkingLabel
        : settledLabel;
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
  entryId,
  logOffset,
  isDetailOpen = false,
  loadError,
  onEntryExpandedChange,
  sessionFileLinks,
}: {
  item: Extract<AgentTimelineItem, { type: "tool_call" }>;
  entryId?: string;
  logOffset?: number;
  isDetailOpen?: boolean;
  loadError?: string;
  onEntryExpandedChange?: (entryId: string, expanded: boolean) => void;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const { messages } = useI18n();
  const [localOpen, setLocalOpen] = useState(false);
  const open = onEntryExpandedChange ? isDetailOpen : localOpen;
  const setOpen = (next: boolean) => {
    if (onEntryExpandedChange && entryId) {
      onEntryExpandedChange(entryId, next);
      return;
    }
    setLocalOpen(next);
  };
  const presentation = buildToolCallPresentation(
    messages.agentsFeature,
    item.name,
    item.detail,
  );
  const hasExpandableDetail =
    hasToolCallDetail(item.detail) || logOffset != null;
  return (
    <article className="agents-message__entry agents-message__entry--tool">
      <div
        className={`agents-message__tool${
          hasExpandableDetail ? " agents-message__tool--expandable" : ""
        }`}
      >
        {hasExpandableDetail ? (
          <details className="agents-message__tool-details" open={open}>
            <summary
              className="agents-message__tool-header"
              onClick={(event) => {
                event.preventDefault();
                setOpen(!open);
              }}
            >
              <ToolCallHeader
                toolName={item.name}
                detail={item.detail}
                presentation={presentation}
                status={item.status}
                isExpandable
              />
            </summary>
            {open ? (
              <ToolCallDetailView
                name={item.name}
                detail={item.detail}
                sessionFileLinks={sessionFileLinks}
              />
            ) : null}
            {loadError ? (
              <p className="agents-message__tool-error" role="status">
                {loadError}
              </p>
            ) : null}
          </details>
        ) : (
          <>
            <div className="agents-message__tool-header">
              <ToolCallHeader
                toolName={item.name}
                detail={item.detail}
                presentation={presentation}
                status={item.status}
                isExpandable={false}
              />
            </div>
            <ToolCallDetailView
              name={item.name}
              detail={item.detail}
              sessionFileLinks={sessionFileLinks}
            />
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
  toolName,
  detail,
  presentation,
  status,
  isExpandable,
}: {
  toolName: string;
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
            <ToolCallIcon name={toolName} detail={detail} />
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

function ToolCallIcon({
  name,
  detail,
}: {
  name: string;
  detail: ToolCallDetail;
}) {
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
    case "collab_agent":
      return <GitBranch aria-hidden="true" size={13} strokeWidth={1.8} />;
    case "unknown":
      return extractTaskUpdateInfo(name, detail) ? (
        <ListChecks aria-hidden="true" size={13} strokeWidth={1.8} />
      ) : null;
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

function TodoCard({
  item,
}: {
  item: Extract<AgentTimelineItem, { type: "todo" }>;
}) {
  const { messages, t } = useI18n();
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
                aria-label={
                  todo.completed
                    ? t("agentsFeature.todoCompleted")
                    : t("agentsFeature.todoIncomplete")
                }
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
