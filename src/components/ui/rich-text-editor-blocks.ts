import type Quill from "quill";

export type RichTextAttachmentKind =
  | "image"
  | "pdf"
  | "word"
  | "text"
  | "generic";

export interface RichTextAttachment {
  token: string;
  displayName: string;
  kind: RichTextAttachmentKind;
  markdownToken: string;
  isPreviewable: boolean;
  imageSrc?: string | null;
  previewLabel?: string;
  downloadLabel?: string;
  removeLabel?: string;
}

export function retainLocalAttachments(
  incoming: RichTextAttachment[],
  local: RichTextAttachment[],
): RichTextAttachment[] {
  const incomingTokens = new Set(
    incoming.map((attachment) => attachment.token),
  );
  return [
    ...incoming,
    ...local.filter((attachment) => !incomingTokens.has(attachment.token)),
  ];
}

// Quill 的 getLine 返回行 blot，这里只用到 domNode（读取行文本）和 length
// （计算行末偏移），因此用最小接口描述，避免引入 Quill 内部 blot 类型。
export interface QuillLine {
  domNode?: Node;
  length?: () => number;
}

// 点击工具栏的块引用 / 代码块按钮时，若未选中任何文本，仅把当前行设为块级
// 格式会让后续回车继续停留在该块内（Quill 会在块内延续格式），用户难以回到
// 普通段落继续输入正文。这里在首次激活块级格式后，额外在当前块下方插入一行
// 普通空行作为离开块的出口；已处于该块级格式时再次点击则按默认语义取消格式。
export function activateBlockFormat(
  quill: Quill,
  format: "blockquote" | "code-block",
) {
  const selection = quill.getSelection();
  if (!selection) {
    return;
  }
  const formats = quill.getFormat(selection) as Record<string, unknown>;
  const isActive = Boolean(formats[format]);
  const rangeLength = selection.length > 0 ? selection.length : 1;
  quill.formatLine(selection.index, rangeLength, format, !isActive, "user");
  if (selection.length === 0 && !isActive) {
    insertExitLineBelow(quill, selection.index, format);
    quill.setSelection(selection.index, 0, "user");
  }
}

function insertExitLineBelow(
  quill: Quill,
  index: number,
  format: "blockquote" | "code-block",
) {
  const [line, offset] = quill.getLine(index) as [QuillLine, number];
  const lineEnd = index - offset + getBlotLength(line);
  quill.insertText(lineEnd, "\n", "user");
  quill.formatLine(lineEnd, 1, format, false, "user");
}

function getBlotLength(line: QuillLine): number {
  return typeof line.length === "function" ? line.length() : 1;
}

export function insertUploadedImage(
  quill: Quill,
  attachment: RichTextAttachment,
): void {
  const insertIndex = quill.getSelection(true)?.index ?? quill.getLength();
  if (attachment.imageSrc) {
    quill.insertEmbed(insertIndex, "image", attachment.imageSrc, "user");
    quill.insertText(insertIndex + 1, "\n", "user");
    quill.setSelection(insertIndex + 2, 0, "user");
  }
}

export async function insertImageBatch(
  quill: Quill,
  uploadNext: () => Promise<RichTextAttachment | null>,
  hasMore: () => boolean,
  readLabels: () => {
    previewAttachment: (displayName: string) => string;
    downloadAttachment: (displayName: string) => string;
    removeAttachment: (displayName: string) => string;
  },
  attachmentsRef: { current: RichTextAttachment[] },
  publish: () => void,
): Promise<void> {
  let nextIndex: number | null = null;
  let attachment = await uploadNext();
  while (attachment) {
    if (nextIndex !== null) {
      const maxIndex = Math.max(quill.getLength() - 1, 0);
      quill.setSelection(Math.min(nextIndex, maxIndex), 0, "user");
    }
    const currentLabels = readLabels();
    const localized = {
      ...attachment,
      previewLabel: currentLabels.previewAttachment(attachment.displayName),
      downloadLabel: currentLabels.downloadAttachment(attachment.displayName),
      removeLabel: currentLabels.removeAttachment(attachment.displayName),
    };
    if (
      !attachmentsRef.current.some((item) => item.token === localized.token)
    ) {
      attachmentsRef.current = [...attachmentsRef.current, localized];
    }
    insertUploadedImage(quill, localized);
    nextIndex = quill.getSelection()?.index ?? nextIndex;
    publish();
    if (!hasMore()) {
      return;
    }
    attachment = await uploadNext();
  }
}
