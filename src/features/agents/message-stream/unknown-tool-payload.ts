// 未知工具（`unknown` detail）raw 载荷的纯解析助手。
//
// 未知工具的 rawInput / rawOutput 是没有约定形状的 JSON 或文本，卡片头部摘要与
// 详情正文都要从中读出少量可读信息（web 搜索的 query、Codex 任务状态更新）。
// 解析口径共用这一处，避免头部与详情分叉；本文件只做解析，不渲染。

import type { ToolCallDetail } from "../agent-stream-types";

type UnknownToolDetail = Extract<ToolCallDetail, { type: "unknown" }>;

/** 把 `web_search` / `write_file` 这类工具名转成 `Web Search` / `Write File`。 */
export function formatToolName(name: string): string {
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** 工具名归一化后是否为 web 搜索（`web_search` / `webSearchToolCall` 等写法）。 */
export function isWebSearchName(name: string): boolean {
  const normalized = name.replace(/[\s_-]+/g, "").toLowerCase();
  return normalized === "websearch" || normalized === "websearchtoolcall";
}

/** 从未知工具的 raw 载荷里读出搜索 query。 */
export function extractUnknownSearchQuery(
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

/** 从未知工具载荷里识别出的 Codex 任务状态更新。 */
export interface TaskUpdateInfo {
  taskId: string;
  status?: string;
}

/** 识别任务状态更新载荷；不是任务更新时返回 null。 */
export function extractTaskUpdateInfo(
  name: string,
  detail: UnknownToolDetail,
): TaskUpdateInfo | null {
  if (!isTaskUpdateName(name) && !looksLikeTaskUpdatePayload(detail)) {
    return null;
  }

  const inputPayload = parseUnknownToolPayload(detail.rawInput);
  const outputPayload = parseUnknownToolPayload(detail.rawOutput);
  const taskId =
    readTaskId(inputPayload) ??
    readTaskId(outputPayload) ??
    extractTaskIdFromText(detail.rawOutput) ??
    extractTaskIdFromText(detail.rawInput);
  if (!taskId) {
    return null;
  }

  return {
    taskId,
    status:
      readTaskStatus(inputPayload) ??
      readTaskStatus(outputPayload) ??
      extractTaskStatusFromText(detail.rawOutput),
  };
}

function isTaskUpdateName(name: string): boolean {
  const normalized = name.replace(/[\s_-]+/g, "").toLowerCase();
  return normalized === "taskupdate";
}

function looksLikeTaskUpdatePayload(detail: UnknownToolDetail): boolean {
  return (
    extractTaskIdFromText(detail.rawInput) != null ||
    extractTaskIdFromText(detail.rawOutput) != null
  );
}

function parseUnknownToolPayload(
  raw: string | undefined,
): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function readTaskId(value: Record<string, unknown> | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const taskId = value.taskId;
  if (typeof taskId === "number") {
    return String(taskId);
  }
  return readString(taskId);
}

function readTaskStatus(
  value: Record<string, unknown> | null,
): string | undefined {
  if (!value) {
    return undefined;
  }
  return readString(value.status);
}

function extractTaskIdFromText(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/task\s*#?(\d+)/i);
  return match?.[1];
}

function extractTaskStatusFromText(
  raw: string | undefined,
): string | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (normalized.includes("completed")) {
    return "completed";
  }
  if (
    normalized.includes("in_progress") ||
    normalized.includes("in progress")
  ) {
    return "in_progress";
  }
  if (normalized.includes("updated")) {
    return "updated";
  }
  return undefined;
}
