// 工具卡头部的展示判定与文案构造，纯函数、不渲染。
//
// - `hasToolCallDetail`：这一条工具调用是否有可展开正文（决定头部是否给展开箭头）；
// - `buildToolCallPresentation`：按 `ToolCallDetail.type` 分支给出显示名与摘要，
//   未知工具从 raw 载荷里尽力读出可读信息（任务状态更新、web 搜索 query），
//   读不出就只显示格式化后的工具名。

import type { I18nMessages } from "../../../shared/i18n/messages";
import type { ToolCallDetail } from "../agent-stream-types";
import {
  extractTaskUpdateInfo,
  extractUnknownSearchQuery,
  formatToolName,
  isWebSearchName,
} from "./unknown-tool-payload";

export interface ToolCallPresentation {
  displayName: string;
  summary?: string;
}

/** 该工具调用是否有可展开的详情正文。 */
export function hasToolCallDetail(detail: ToolCallDetail): boolean {
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

export function buildToolCallPresentation(
  copy: I18nMessages["agentsFeature"],
  name: string,
  detail: ToolCallDetail,
): ToolCallPresentation {
  switch (detail.type) {
    case "shell":
      return { displayName: copy.toolShell, summary: detail.command };
    case "edit":
      return { displayName: copy.toolEdit, summary: detail.path };
    case "write":
      return { displayName: copy.toolWrite, summary: detail.path };
    case "read":
      return { displayName: copy.toolRead, summary: detail.path };
    case "search":
      return { displayName: copy.toolSearch, summary: detail.query };
    case "sub_agent":
      return {
        displayName: copy.toolTask,
        summary: detail.childSessionId
          ? copy.subSession(detail.childSessionId)
          : undefined,
      };
    case "collab_agent":
      return {
        displayName: copy.toolCollab,
        summary: detail.prompt,
      };
    case "plan":
      return { displayName: copy.toolPlan };
    case "unknown":
      return buildUnknownToolCallPresentation(copy, name, detail);
    default:
      return { displayName: formatToolName(name) };
  }
}

function buildUnknownToolCallPresentation(
  copy: I18nMessages["agentsFeature"],
  name: string,
  detail: Extract<ToolCallDetail, { type: "unknown" }>,
): ToolCallPresentation {
  const taskUpdate = extractTaskUpdateInfo(name, detail);
  if (taskUpdate) {
    const statusLabel = copy.taskStatusLabel(taskUpdate.status ?? "updated");
    return {
      displayName: copy.toolTask,
      summary: copy.taskUpdateSummary(taskUpdate.taskId, statusLabel),
    };
  }

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
