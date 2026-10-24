// 工具卡展开后的正文渲染（shell / read / edit / write / search / 子智能体 / 未知工具）。
//
// 从 `agent-message-cards.tsx` 拆出：卡片分发与头部留在那里，正文与相关 helper 归本文件。
// 视觉遵循 DESIGN_GUIDE：黑白灰优先、12px Mono、1px 边框、无阴影、状态不只靠颜色。

import { ChevronRight, Copy, ExternalLink } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { copyTextToClipboard } from "../../../shared/commands/copy-text-to-clipboard";
import { useI18n } from "../../../shared/i18n/i18n";
import { toast } from "../../../shared/toast";
import type { ToolCallDetail } from "../agent-stream-types";
import { HighlightedDiffBlock } from "./highlighted-diff-block";
import {
  resolveWorkspaceRelativePath,
  type SessionFileLinks,
} from "./session-file-links";
import {
  formatSearchMode,
  truncateToolDetailText,
  type TruncatedToolText,
} from "./tool-detail-text";
import {
  countTextLines,
  isFoldableToolDiff,
  isFoldableToolOutput,
} from "./tool-output-fold";
import { extractTaskUpdateInfo } from "./unknown-tool-payload";

export function ToolCallDetailView({
  name,
  detail,
  sessionFileLinks,
}: {
  name: string;
  detail: ToolCallDetail;
  /** 本地文件链接能力；`undefined` 时路径只显示文本。 */
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const { messages, t } = useI18n();
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
              <ShellCommandRow command={detail.command} />
              {shellOutput ? (
                <ToolOutput
                  text={shellOutput.text}
                  truncatedNote={
                    shellOutput.isTruncated ? (
                      <TruncationNote truncated={shellOutput} />
                    ) : null
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "read":
      return (
        <FileContentToolBody
          path={detail.path}
          text={detail.content}
          sessionFileLinks={sessionFileLinks}
        />
      );
    case "edit":
      return (
        <EditToolBody
          path={detail.path}
          diff={detail.diff}
          sessionFileLinks={sessionFileLinks}
        />
      );
    case "write":
      return (
        <FileContentToolBody
          path={detail.path}
          text={detail.content}
          sessionFileLinks={sessionFileLinks}
        />
      );
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

    case "collab_agent":
      return detail.prompt ? (
        <div className="agents-message__tool-body">
          <p className="agents-message__plan">{detail.prompt}</p>
        </div>
      ) : null;
    case "plan":
      return (
        <div className="agents-message__tool-body">
          <p className="agents-message__plan">{detail.text}</p>
        </div>
      );
    default: {
      const taskUpdate = extractTaskUpdateInfo(name, detail);
      if (taskUpdate) {
        const statusLabel = messages.agentsFeature.taskStatusLabel(
          taskUpdate.status ?? "updated",
        );
        return (
          <div className="agents-message__tool-body">
            <p className="agents-message__plan">
              {messages.agentsFeature.taskUpdateDetail(
                taskUpdate.taskId,
                statusLabel,
              )}
            </p>
          </div>
        );
      }
      return (
        <div className="agents-message__tool-body">
          {detail.rawInput || detail.rawOutput ? (
            // 未知工具的 raw 载荷不做主正文铺开：它没有约定形状，铺开只会把
            // 消息流变成 JSON 垃圾场，一律收进卡内折叠详情（默认收起）。
            <ToolDetailFold
              expandLabel={t("agentsFeature.toolRawDetail")}
              collapseLabel={t("agentsFeature.toolRawDetail")}
            >
              <div className="agents-message__tool-output">
                {detail.rawInput ? (
                  <pre className="agents-message__output">
                    {detail.rawInput}
                  </pre>
                ) : null}
                {detail.rawOutput ? (
                  <pre className="agents-message__output">
                    {detail.rawOutput}
                  </pre>
                ) : null}
              </div>
            </ToolDetailFold>
          ) : null}
        </div>
      );
    }
  }
}

/**
 * 工具卡里的文件路径：能收成工作区相对路径时渲染成按钮（点击交给侧栏
 * `SessionFileViewer`），收不干净时回落纯文本（与 `AgentMarkdown` 同口径）。
 */
function ToolPath({
  path,
  sessionFileLinks,
}: {
  path: string;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const { t } = useI18n();
  const filePath =
    sessionFileLinks === undefined
      ? null
      : resolveWorkspaceRelativePath(
          path,
          sessionFileLinks.workspacePath,
          sessionFileLinks.homePath,
        );
  // 中间的 undefined 判定只为让 TS 收窄出 sessionFileLinks：
  // filePath 返回非 null 时它必然已定义。
  if (filePath === null || sessionFileLinks === undefined) {
    return (
      <code className="agents-message__path agents-message__path--details">
        {path}
      </code>
    );
  }

  const openFilePath = sessionFileLinks.openFilePath;
  return (
    <button
      type="button"
      className="agents-message__path agents-message__path--details agents-message__path--button"
      aria-label={t("agentsFeature.openWorkspaceFileLink", { path: filePath })}
      onClick={() => openFilePath(filePath)}
    >
      {path}
    </button>
  );
}

/**
 * 卡内嵌套折叠：大输出 / 大 diff / 未知工具 raw 载荷的默认收起容器。
 *
 * 状态只属于这一层（本地 `useState`），不写回消息流状态；摘要文案随展开状态切换。
 */
function ToolDetailFold({
  expandLabel,
  collapseLabel,
  children,
}: {
  expandLabel: string;
  collapseLabel: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className="agents-message__tool-fold" open={isOpen}>
      <summary
        className="agents-message__tool-fold-summary"
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((previous) => !previous);
        }}
      >
        <ChevronRight
          aria-hidden="true"
          size={12}
          strokeWidth={1.8}
          className="agents-message__tool-fold-chevron"
        />
        <span>{isOpen ? collapseLabel : expandLabel}</span>
      </summary>
      <div className="agents-message__tool-fold-body">{children}</div>
    </details>
  );
}

/** shell 命令行：命令文本 + 复制按钮（icon-only，可访问名称来自 `copyCommand`）。 */
function ShellCommandRow({ command }: { command: string }) {
  const { messages, t } = useI18n();
  const handleCopy = useCallback(async () => {
    if (await copyTextToClipboard(command)) {
      toast.success(messages.agentsFeature.copiedToClipboard);
      return;
    }
    // 新增文案只走 `t("agentsFeature.x")`，不扩 `I18nMessages` 接口。
    toast.error(t("agentsFeature.copyFailed"));
  }, [command, messages.agentsFeature.copiedToClipboard, t]);

  return (
    <div className="agents-message__command-row">
      <code className="agents-message__command agents-message__command--details">
        {command}
      </code>
      <button
        type="button"
        className="agents-message__command-copy"
        aria-label={t("agentsFeature.copyCommand")}
        onClick={() => void handleCopy()}
      >
        <Copy aria-hidden="true" size={12} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/** 工具输出正文：超过阈值时收进嵌套折叠，默认收起；截断提示留在折叠外始终可见。 */
function ToolOutput({
  text,
  truncatedNote,
}: {
  text: string;
  truncatedNote?: ReactNode;
}) {
  const { t } = useI18n();
  const output = <pre className="agents-message__output">{text}</pre>;
  if (!isFoldableToolOutput(text)) {
    return (
      <>
        {output}
        {truncatedNote ?? null}
      </>
    );
  }
  return (
    <>
      <ToolDetailFold
        expandLabel={t("agentsFeature.toolOutputExpand", {
          lines: countTextLines(text),
        })}
        collapseLabel={t("agentsFeature.toolOutputCollapse")}
      >
        {output}
      </ToolDetailFold>
      {truncatedNote ?? null}
    </>
  );
}

/** 输出被截断时的提示（沿用既有文案与 role）。 */
function TruncationNote({ truncated }: { truncated: TruncatedToolText }) {
  const { messages } = useI18n();
  return (
    <p className="agents-message__truncated" role="status">
      {messages.agentsFeature.toolOutputTruncated(
        truncated.visibleCharacters,
        truncated.totalCharacters,
      )}
    </p>
  );
}

/** read / write 正文：路径按钮 + 文件内容（大内容默认收起）。 */
function FileContentToolBody({
  path,
  text,
  sessionFileLinks,
}: {
  path: string;
  text: string | undefined;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const content = truncateToolDetailText(text);
  return (
    <div className="agents-message__tool-body">
      {content ? (
        <div className="agents-message__tool-output">
          <ToolPath path={path} sessionFileLinks={sessionFileLinks} />
          <ToolOutput
            text={content.text}
            truncatedNote={
              content.isTruncated ? (
                <TruncationNote truncated={content} />
              ) : null
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/** edit 正文：路径按钮 + 高亮 diff（大 diff 默认收起）。 */
function EditToolBody({
  path,
  diff,
  sessionFileLinks,
}: {
  path: string;
  diff: string | undefined;
  sessionFileLinks: SessionFileLinks | undefined;
}) {
  const { t } = useI18n();
  const editDiff = truncateToolDetailText(diff);
  return (
    <div className="agents-message__tool-body">
      {editDiff ? (
        <div className="agents-message__tool-output">
          <ToolPath path={path} sessionFileLinks={sessionFileLinks} />
          {isFoldableToolDiff(editDiff.text) ? (
            <ToolDetailFold
              expandLabel={t("agentsFeature.toolDiffExpand", {
                lines: countTextLines(editDiff.text),
              })}
              collapseLabel={t("agentsFeature.toolDiffCollapse")}
            >
              <HighlightedDiffBlock diff={editDiff.text} path={path} />
            </ToolDetailFold>
          ) : (
            <HighlightedDiffBlock diff={editDiff.text} path={path} />
          )}
          {editDiff.isTruncated ? (
            <TruncationNote truncated={editDiff} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
