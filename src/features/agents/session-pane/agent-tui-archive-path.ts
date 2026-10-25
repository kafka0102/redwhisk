/**
 * TUI Issue 归档路径与回看正文预处理（与后端 session-logs/archive 布局对齐）。
 */

/** 路径是否含连续段 `session-logs` + `archive`（Issue 完成归档日志）。 */
export function isTuiArchiveLogPath(
  logPath: string | null | undefined,
): boolean {
  if (logPath == null || logPath.trim() === "") {
    return false;
  }
  const normalized = logPath.replace(/\\/g, "/");
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      segments[index] === "session-logs" &&
      segments[index + 1] === "archive"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 归档快照 → AgentMarkdown 源文：去掉交付标签；将 `• ## 标题` 收成 ATX 标题，
 * 便于与 JSON 模式一致渲染标题层级。不剥离 ** / 链接等行内标记。
 */
export function prepareTuiArchiveMarkdownForRender(text: string): string {
  if (text === "") {
    return "";
  }
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => {
    let next = line
      .replace(/<\/?issue-comment>/gi, "")
      .replace(/<\/?issue-comment\s*\/?>/gi, "");
    // 可选列表符（• / - / * / 数字.）后接 ATX 标题 → 仅保留标题标记。
    next = next.replace(/^(\s*)(?:[•\-*]|\d+\.)\s+(#{1,6}\s+\S.*)$/u, "$1$2");
    return next;
  });
  return collapseBlankLines(lines);
}

export type JsonArchiveReviewCard =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "error"; text: string };

/**
 * JSON 时间轴按文件顺序成卡。不是 JSON 归档时返回 null。
 * 工具、推理和其它类型丢掉。回看直接用这些卡，避免再铺成一篇正文。
 */
export function jsonArchiveReviewCards(
  text: string,
): JsonArchiveReviewCard[] | null {
  const lines = text.split("\n").filter((line) => line.trim().startsWith("{"));
  if (lines.length === 0) {
    return null;
  }
  const cards: ParsedArchiveCard[] = [];
  let parsed = 0;
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    parsed += 1;
    const parsedCard = jsonArchiveCard(value);
    if (parsedCard != null) {
      rememberArchiveCard(cards, parsedCard);
    }
  }
  if (parsed === 0) {
    return null;
  }
  return cards.map((placed) => placed.card);
}

interface ParsedArchiveCard {
  card: JsonArchiveReviewCard;
  messageId: string | null;
  source: string | null;
}

function rememberArchiveCard(
  cards: ParsedArchiveCard[],
  next: ParsedArchiveCard,
): void {
  if (next.card.kind === "user" && next.messageId != null) {
    const index = cards.findIndex(
      (existing) =>
        existing.card.kind === "user" && existing.messageId === next.messageId,
    );
    if (index >= 0) {
      cards[index] = next;
      return;
    }
  }
  if (next.card.kind === "assistant" && next.messageId != null) {
    const index = cards.findIndex(
      (existing) =>
        existing.card.kind === "assistant" &&
        existing.messageId === next.messageId &&
        existing.source === next.source,
    );
    if (index >= 0) {
      cards[index] = next;
      return;
    }
  }
  if (next.card.kind === "user" && next.messageId == null) {
    const last = cards[cards.length - 1];
    if (
      last?.card.kind === "user" &&
      sameArchiveUserText(last.card.text, next.card.text)
    ) {
      cards[cards.length - 1] = {
        card: next.card,
        messageId: last.messageId,
        source: last.source,
      };
      return;
    }
  }
  cards.push(next);
}

function sameArchiveUserText(left: string, right: string): boolean {
  return normalizeArchiveNewlines(left) === normalizeArchiveNewlines(right);
}

function normalizeArchiveNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function jsonArchiveCard(value: unknown): ParsedArchiveCard | null {
  const item = timelineItem(value);
  if (item == null) {
    return null;
  }
  const type = stringField(item, "type");
  if (type === "error") {
    const message = stringField(item, "message");
    if (message == null || message.trim() === "") {
      return null;
    }
    return {
      card: { kind: "error", text: message },
      messageId: null,
      source: null,
    };
  }
  if (type !== "user_message" && type !== "assistant_message") {
    return null;
  }
  const body = stringField(item, "text");
  if (body == null || body.trim() === "") {
    return null;
  }
  return {
    card:
      type === "user_message"
        ? { kind: "user", text: body }
        : { kind: "assistant", text: body },
    messageId: optionalId(item, "messageId"),
    source:
      type === "assistant_message" ? optionalId(item, "subagentId") : null,
  };
}

function optionalId(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = stringField(record, key);
  if (value == null || value.trim() === "") {
    return null;
  }
  return value;
}

function timelineItem(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  const event = (value as { event?: unknown }).event;
  if (event == null || typeof event !== "object") {
    return null;
  }
  const item = (event as { item?: unknown }).item;
  if (item == null || typeof item !== "object") {
    return null;
  }
  return item as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function collapseBlankLines(lines: string[]): string {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 1) {
        continue;
      }
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line);
  }
  while (out.length > 0 && out[0] === "") {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  return out.join("\n");
}

/** 归档回看读盘上限：结论归档通常短于 live ring，但仍可能超默认 32KiB。 */
export const TUI_ARCHIVE_READ_MAX_BYTES = 512_000;
