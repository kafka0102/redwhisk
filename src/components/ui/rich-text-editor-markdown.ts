import type { RichTextAttachment } from "./rich-text-editor";

// Quill delta 的最小操作描述：编辑器正文只用到 insert（字符串或 image embed）
// 与 attributes（行内/块级格式）。这里只建模转换所需字段，避免引入完整 Delta 类型。
export interface DeltaOperation {
  insert?: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export function markdownToDelta(
  markdown: string,
  attachments: RichTextAttachment[],
): { ops: DeltaOperation[] } {
  const ops: DeltaOperation[] = [];
  const usedTokens = new Set<string>();
  const attachmentsByToken = new Map(
    attachments.map((attachment) => [attachment.markdownToken, attachment]),
  );
  const lines = normalizeLineEndings(markdown).split("\n");
  // 预判哪些行应按有序列表解析：孤立的「N. 段落」（尤其 N≠1）保留字面序号，
  // 避免 Quill 有序列表从 1 重排（粘贴「4. 标题」却显示成「1. 标题」）。
  const orderedListLineIndexes = resolveOrderedListLineIndexes(lines);
  const imageLinePattern = /^!\[([^\]]*)\]\(([^)]+)\)$/;
  let isReadingCodeBlock = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("```")) {
      isReadingCodeBlock = !isReadingCodeBlock;
      continue;
    }

    if (isReadingCodeBlock) {
      ops.push({ insert: line });
      ops.push({ insert: "\n", attributes: { "code-block": true } });
      continue;
    }

    // 优先识别 Markdown 图片占位符 ![alt](token)：若 URL 是某个图片附件的
    // markdownToken，则还原为图片 embed；否则按普通文本行处理。
    const imageMatch = imageLinePattern.exec(trimmedLine);
    if (imageMatch) {
      const imageAttachment = attachmentsByToken.get(imageMatch[2]);
      if (imageAttachment && imageAttachment.kind === "image") {
        pushAttachmentDelta(ops, imageAttachment);
        ops.push({ insert: "\n" });
        usedTokens.add(imageAttachment.markdownToken);
        continue;
      }
    }

    const attachment = attachmentsByToken.get(trimmedLine);
    if (attachment) {
      pushAttachmentDelta(ops, attachment);
      ops.push({ insert: "\n" });
      usedTokens.add(attachment.markdownToken);
      continue;
    }

    const parsedLine = parseMarkdownLine(
      line,
      orderedListLineIndexes.has(lineIndex),
    );
    ops.push(...parseInlineMarkdown(parsedLine.text));
    ops.push({ insert: "\n", attributes: parsedLine.attributes });
  }

  for (const attachment of attachments) {
    if (usedTokens.has(attachment.markdownToken)) {
      continue;
    }
    pushAttachmentDelta(ops, attachment);
    ops.push({ insert: "\n" });
  }

  return { ops: ops.length > 0 ? ops : [{ insert: "\n" }] };
}

function pushAttachmentDelta(
  operations: DeltaOperation[],
  attachment: RichTextAttachment,
) {
  if (attachment.kind === "image" && attachment.imageSrc) {
    operations.push({
      insert: { image: attachment.imageSrc },
      attributes: { alt: attachment.displayName },
    });
    return;
  }

  // 非图片附件不进入编辑器正文（仅在底部卡片区展示）。这里不 push 任何
  // 文本 token，避免 token 字符串泄漏成可见正文。
}

export function deltaToMarkdown(
  operations: DeltaOperation[],
  attachments: RichTextAttachment[],
): string {
  const lines: string[] = [];
  let currentLine = "";
  let orderedIndex = 1;
  let isWritingCodeBlock = false;

  const finishCodeBlock = () => {
    if (isWritingCodeBlock) {
      lines.push("```");
      isWritingCodeBlock = false;
    }
  };

  const pushLine = (
    line: string,
    attributes: Record<string, unknown> | undefined,
  ) => {
    if (isCodeBlockAttributes(attributes)) {
      if (!isWritingCodeBlock) {
        lines.push("```");
        isWritingCodeBlock = true;
      }
      lines.push(line);
      orderedIndex = 1;
      return;
    }

    finishCodeBlock();
    const formattedLine = formatBlockMarkdown(line, attributes, orderedIndex);
    if (attributes?.list === "ordered" && line.length > 0) {
      orderedIndex += 1;
    } else if (attributes?.list !== "ordered") {
      orderedIndex = 1;
    }
    lines.push(formattedLine);
  };

  for (const operation of operations) {
    const attachment = getAttachmentInsert(operation, attachments);
    if (attachment) {
      if (currentLine.length > 0) {
        pushLine(currentLine, undefined);
        currentLine = "";
      }
      finishCodeBlock();
      // 图片附件序列化为 Markdown 图片语法，URL 用其 markdownToken 占位
      // （draft 为 {{issue-attachment-temp:token}}，保存后由 Rust 重写为
      // {{issue-attachment:id}}）。非图片附件理论上不会出现在正文 ops 中
      // （pushAttachmentDelta 不再写入），这里兜底按裸 token 行处理。
      if (attachment.kind === "image" && attachment.imageSrc) {
        lines.push(`![${attachment.displayName}](${attachment.markdownToken})`);
      } else {
        lines.push(attachment.markdownToken);
      }
      orderedIndex = 1;
      continue;
    }

    if (typeof operation.insert !== "string") {
      continue;
    }

    const segments = operation.insert.split("\n");
    segments.forEach((segment, index) => {
      currentLine += formatInlineMarkdown(segment, operation.attributes);
      if (index < segments.length - 1) {
        pushLine(currentLine, operation.attributes);
        currentLine = "";
      }
    });
  }

  if (currentLine.length > 0) {
    pushLine(currentLine, undefined);
  }
  finishCodeBlock();

  return normalizeMarkdown(lines.join("\n"));
}

export function mergeMarkdownAttachments(
  markdown: string,
  attachments: RichTextAttachment[],
): string {
  const visibleMarkdown = removeHiddenAttachmentTokenLines(
    normalizeMarkdown(markdown),
    attachments,
  );
  const missingAttachments = attachments.filter(
    (attachment) =>
      attachment.kind === "image" &&
      attachment.imageSrc &&
      !visibleMarkdown.includes(attachment.markdownToken),
  );

  if (missingAttachments.length === 0) {
    return visibleMarkdown;
  }

  // 只有图片附件需要进入 Quill 正文；非图片附件 token 是隐藏持久化数据，
  // 由 issue 提交流程补齐，不能参与可见编辑器内容同步。
  const missingLines = missingAttachments.map(
    (attachment) => `![${attachment.displayName}](${attachment.markdownToken})`,
  );

  if (visibleMarkdown.length === 0) {
    return missingLines.join("\n");
  }

  return `${visibleMarkdown}\n\n${missingLines.join("\n")}`;
}

function removeHiddenAttachmentTokenLines(
  markdown: string,
  attachments: RichTextAttachment[],
): string {
  const hiddenTokens = new Set(
    attachments
      .filter(
        (attachment) =>
          attachment.kind !== "image" || attachment.imageSrc == null,
      )
      .map((attachment) => attachment.markdownToken),
  );

  if (hiddenTokens.size === 0) {
    return markdown;
  }

  return normalizeMarkdown(
    markdown
      .split("\n")
      .filter((line) => !hiddenTokens.has(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

// 识别单个 delta 操作是否承载某个附件（图片 embed 或裸 token 文本）。
// 供 deltaToMarkdown 序列化与编辑器内删除附件两处复用，避免查找逻辑分叉。
export function getAttachmentInsert(
  operation: DeltaOperation,
  attachments: RichTextAttachment[],
): RichTextAttachment | null {
  if (typeof operation.insert === "string") {
    return (
      attachments.find(
        (attachment) => attachment.markdownToken === operation.insert,
      ) ?? null
    );
  }

  const imageSrc =
    operation.insert &&
    typeof operation.insert === "object" &&
    typeof operation.insert.image === "string"
      ? operation.insert.image
      : null;
  if (imageSrc) {
    return (
      attachments.find((attachment) => attachment.imageSrc === imageSrc) ?? null
    );
  }

  return null;
}

const ORDERED_LIST_LINE_PATTERN = /^\s*\d+\.\s+/;
const ORDERED_LIST_START_ONE_PATTERN = /^\s*1\.\s+/;

// 判定哪些「数字. 」行应解析为有序列表：
// - 相邻多行均匹配数字序号 → 视为列表块（与常见 Markdown 列表一致）；
// - 孤立单行仅当以「1. 」开头时才视为列表（与编辑器输入快捷方式一致）；
// - 孤立的「4. 段落标题」等保留字面文本，避免 Quill 从 1 重排序号。
// 代码围栏内的行不参与判定，避免 fenced code 被误伤。
function resolveOrderedListLineIndexes(lines: string[]): Set<number> {
  const candidateIndexes: number[] = [];
  let isReadingCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("```")) {
      isReadingCodeBlock = !isReadingCodeBlock;
      continue;
    }
    if (isReadingCodeBlock) {
      continue;
    }
    if (ORDERED_LIST_LINE_PATTERN.test(lines[index])) {
      candidateIndexes.push(index);
    }
  }

  const orderedIndexes = new Set<number>();
  for (const index of candidateIndexes) {
    const hasNeighborCandidate =
      candidateIndexes.includes(index - 1) ||
      candidateIndexes.includes(index + 1);
    if (
      hasNeighborCandidate ||
      ORDERED_LIST_START_ONE_PATTERN.test(lines[index])
    ) {
      orderedIndexes.add(index);
    }
  }
  return orderedIndexes;
}

function parseMarkdownLine(
  line: string,
  treatAsOrderedList: boolean,
): {
  text: string;
  attributes?: Record<string, unknown>;
} {
  if (line.startsWith(">")) {
    return {
      text: line.replace(/^>\s?/, ""),
      attributes: { blockquote: true },
    };
  }
  if (line.startsWith("## ")) {
    return { text: line.slice(3), attributes: { header: 2 } };
  }
  if (line.startsWith("# ")) {
    return { text: line.slice(2), attributes: { header: 1 } };
  }
  if (/^\s*[-*]\s+/.test(line)) {
    return {
      text: line.replace(/^\s*[-*]\s+/, ""),
      attributes: { list: "bullet" },
    };
  }
  if (treatAsOrderedList && ORDERED_LIST_LINE_PATTERN.test(line)) {
    return {
      text: line.replace(ORDERED_LIST_LINE_PATTERN, ""),
      attributes: { list: "ordered" },
    };
  }
  return { text: line };
}

function parseInlineMarkdown(text: string): DeltaOperation[] {
  const operations: DeltaOperation[] = [];
  const inlinePattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > cursor) {
      operations.push({ insert: text.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      operations.push({ insert: match[1], attributes: { code: true } });
    } else {
      operations.push({ insert: match[2], attributes: { bold: true } });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    operations.push({ insert: text.slice(cursor) });
  }

  return operations;
}

function formatInlineMarkdown(
  text: string,
  attributes?: Record<string, unknown>,
): string {
  if (text.length === 0) {
    return "";
  }

  let formattedText = text;
  if (attributes?.code === true) {
    formattedText = `\`${formattedText}\``;
  }
  if (attributes?.bold === true) {
    formattedText = `**${formattedText}**`;
  }
  return formattedText;
}

function formatBlockMarkdown(
  line: string,
  attributes: Record<string, unknown> | undefined,
  orderedIndex: number,
): string {
  if (line.length === 0) {
    return "";
  }
  if (attributes?.blockquote) {
    return `> ${line}`;
  }
  if (attributes?.header === 1) {
    return `# ${line}`;
  }
  if (attributes?.header === 2) {
    return `## ${line}`;
  }
  if (attributes?.list === "bullet") {
    return `- ${line}`;
  }
  if (attributes?.list === "ordered") {
    return `${orderedIndex}. ${line}`;
  }
  return line;
}

function isCodeBlockAttributes(
  attributes: Record<string, unknown> | undefined,
): boolean {
  return (
    attributes?.["code-block"] !== undefined &&
    attributes["code-block"] !== false
  );
}

// 统一 markdown 文本：合并换行风格、折叠多余空行、去尾部空白。导出供编辑器
// 在 onChange / 同步等位置复用，保证序列化与外部存储的 markdown 一致。
export function normalizeMarkdown(markdown: string): string {
  return normalizeLineEndings(markdown)
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
