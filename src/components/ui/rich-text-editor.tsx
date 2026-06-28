import { useEffect, useMemo, useRef } from "react";
import {
  Bold,
  Image as ImageIcon,
  List,
  ListOrdered,
  Paperclip,
} from "lucide-react";
import Quill from "quill";
import "quill/dist/quill.snow.css";

// Quill 内置 image blot 的 sanitize 只允许 http/https/data 协议，会把
// `asset://localhost/...`（Tauri 在 macOS/Linux 上 convertFileSrc 的产物）
// 清洗成 `//:0`，导致插入的图片渲染成破损图。这里覆盖 sanitize，把 Tauri 的
// asset 协议加入白名单，使编辑器内图片能正常显示。
interface ImageBlotConstructor {
  new (...args: unknown[]): ImageBlotInstance;
  blotName: string;
  tagName: string | string[];
  create(value?: unknown): Node;
  sanitize(url: string): string;
}

interface ImageBlotInstance {
  domNode: HTMLElement;
}

const NativeImageBlot = Quill.import(
  "formats/image",
) as unknown as ImageBlotConstructor;

class AssetImageBlot extends NativeImageBlot {
  static sanitize(url: string): string {
    return isAllowedProtocol(url, ["http", "https", "data", "asset"])
      ? url
      : "//:0";
  }
}

Quill.register("formats/image", AssetImageBlot, true);

function isAllowedProtocol(url: string, allowed: string[]): boolean {
  const anchor = document.createElement("a");
  anchor.href = url;
  const protocol = anchor.href.slice(0, anchor.href.indexOf(":"));
  return allowed.includes(protocol);
}

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

export interface RichTextEditorLabels {
  attachFile: string;
  bold: string;
  heading: string;
  image: string;
  normalText: string;
  headingOne: string;
  headingTwo: string;
  orderedList: string;
  previewAttachment: (displayName: string) => string;
  downloadAttachment: (displayName: string) => string;
  removeAttachment: (displayName: string) => string;
  unorderedList: string;
}

interface RichTextEditorProps {
  ariaLabel: string;
  attachments?: RichTextAttachment[];
  labels: RichTextEditorLabels;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onDownloadAttachment?: (attachment: RichTextAttachment) => void;
  onPreviewAttachment?: (attachment: RichTextAttachment) => void;
  onRemoveAttachment?: (attachment: RichTextAttachment) => void;
  onUploadAttachment?: () => Promise<RichTextAttachment | null>;
  onUploadImage?: () => Promise<RichTextAttachment | null>;
}

interface DeltaOperation {
  insert?: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

interface QuillLine {
  domNode?: Node;
}

export function RichTextEditor({
  ariaLabel,
  attachments = [],
  labels,
  onChange,
  onDownloadAttachment,
  onPreviewAttachment,
  onRemoveAttachment,
  onUploadAttachment,
  onUploadImage,
  placeholder,
  value,
}: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const syncingRef = useRef(false);
  const attachmentsRef = useRef(attachments);
  const labelsRef = useRef(labels);
  const handlersRef = useRef({
    onChange,
    onDownloadAttachment,
    onPreviewAttachment,
    onRemoveAttachment,
    onUploadAttachment,
    onUploadImage,
  });
  const localizedAttachments = useMemo(
    () =>
      attachments.map((attachment) => ({
        ...attachment,
        previewLabel: labels.previewAttachment(attachment.displayName),
        downloadLabel: labels.downloadAttachment(attachment.displayName),
        removeLabel: labels.removeAttachment(attachment.displayName),
      })),
    [attachments, labels],
  );

  const editorMarkdown = useMemo(
    () => mergeMarkdownAttachments(value, localizedAttachments),
    [localizedAttachments, value],
  );

  useEffect(() => {
    labelsRef.current = labels;
    attachmentsRef.current = localizedAttachments;
    handlersRef.current = {
      onChange,
      onDownloadAttachment,
      onPreviewAttachment,
      onRemoveAttachment,
      onUploadAttachment,
      onUploadImage,
    };
  }, [
    labels,
    localizedAttachments,
    onChange,
    onDownloadAttachment,
    onPreviewAttachment,
    onRemoveAttachment,
    onUploadAttachment,
    onUploadImage,
  ]);

  useEffect(() => {
    const containerElement = containerRef.current;
    const editorHostElement = editorHostRef.current;
    const toolbarElement = toolbarRef.current;

    async function uploadImageAtSelection() {
      const quill = quillRef.current;
      const uploadImage = handlersRef.current.onUploadImage;
      if (!quill || !uploadImage) {
        return;
      }

      const attachment = await uploadImage();
      if (!attachment) {
        return;
      }
      const currentLabels = labelsRef.current;
      const localizedAttachment = {
        ...attachment,
        previewLabel: currentLabels.previewAttachment(attachment.displayName),
        downloadLabel: currentLabels.downloadAttachment(attachment.displayName),
        removeLabel: currentLabels.removeAttachment(attachment.displayName),
      };
      if (
        !attachmentsRef.current.some(
          (item) => item.token === localizedAttachment.token,
        )
      ) {
        attachmentsRef.current = [
          ...attachmentsRef.current,
          localizedAttachment,
        ];
      }

      const insertIndex = quill.getSelection(true)?.index ?? quill.getLength();
      if (localizedAttachment.imageSrc) {
        quill.insertEmbed(
          insertIndex,
          "image",
          localizedAttachment.imageSrc,
          "user",
        );
        quill.insertText(insertIndex + 1, "\n", "user");
        quill.setSelection(insertIndex + 2, 0, "user");
      }
    }

    async function uploadAttachmentAtSelection() {
      const quill = quillRef.current;
      const uploadAttachment = handlersRef.current.onUploadAttachment;
      if (!quill || !uploadAttachment) {
        return;
      }

      const attachment = await uploadAttachment();
      if (!attachment) {
        return;
      }
      const currentLabels = labelsRef.current;
      const localizedAttachment = {
        ...attachment,
        previewLabel: currentLabels.previewAttachment(attachment.displayName),
        downloadLabel: currentLabels.downloadAttachment(attachment.displayName),
        removeLabel: currentLabels.removeAttachment(attachment.displayName),
      };
      if (
        !attachmentsRef.current.some(
          (item) => item.token === localizedAttachment.token,
        )
      ) {
        attachmentsRef.current = [
          ...attachmentsRef.current,
          localizedAttachment,
        ];
      }

      // 非图片附件不插入编辑器正文，仅在底部卡片区展示；其 token 由
      // mergeMarkdownAttachments 追加到 markdown 末尾（满足 Rust 硬约束）。
      handlersRef.current.onChange(
        normalizeMarkdown(
          deltaToMarkdown(getQuillOperations(quill), attachmentsRef.current),
        ),
      );
    }

    if (!editorHostElement || !toolbarElement || quillRef.current) {
      return;
    }

    const quill = new Quill(editorHostElement, {
      bounds: containerElement ?? undefined,
      modules: {
        toolbar: {
          container: toolbarElement,
          handlers: {
            attachment: () => {
              void uploadAttachmentAtSelection();
            },
            image: () => {
              void uploadImageAtSelection();
            },
          },
        },
      },
      placeholder,
      theme: "snow",
    });
    quillRef.current = quill;
    quill.root.setAttribute("aria-label", ariaLabel);
    quill.root.setAttribute("aria-multiline", "true");
    quill.root.setAttribute("autocapitalize", "none");
    quill.root.setAttribute("autocorrect", "off");
    quill.root.setAttribute("spellcheck", "false");

    const handleTextChange = (
      _delta: unknown,
      _oldDelta: unknown,
      source: string,
    ) => {
      if (syncingRef.current) {
        return;
      }

      if (source === "user") {
        applyMarkdownShortcuts(quill);
      }

      handlersRef.current.onChange(
        normalizeMarkdown(
          deltaToMarkdown(getQuillOperations(quill), attachmentsRef.current),
        ),
      );
    };

    quill.on("text-change", handleTextChange);

    return () => {
      quill.off("text-change", handleTextChange);
      quillRef.current = null;
    };
  }, [ariaLabel, placeholder]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }

    const currentMarkdown = normalizeMarkdown(
      deltaToMarkdown(getQuillOperations(quill), attachmentsRef.current),
    );
    const nextMarkdown = normalizeMarkdown(editorMarkdown);
    if (currentMarkdown === nextMarkdown) {
      return;
    }

    syncingRef.current = true;
    quill.setContents(
      markdownToDelta(nextMarkdown, attachmentsRef.current).ops,
    );
    syncingRef.current = false;
  }, [editorMarkdown]);

  return (
    <div className="rich-text-editor" ref={containerRef}>
      <div
        className="rich-text-editor__toolbar"
        ref={toolbarRef}
        aria-label={labels.heading}
      >
        <select
          className="ql-header"
          defaultValue=""
          aria-label={labels.heading}
        >
          <option value="">{labels.normalText}</option>
          <option value="1">{labels.headingOne}</option>
          <option value="2">{labels.headingTwo}</option>
        </select>
        <button aria-label={labels.bold} className="ql-bold" type="button">
          <Bold aria-hidden="true" size={15} strokeWidth={2} />
        </button>
        <button
          aria-label={labels.unorderedList}
          className="ql-list"
          type="button"
          value="bullet"
        >
          <List aria-hidden="true" size={15} strokeWidth={2} />
        </button>
        <button
          aria-label={labels.orderedList}
          className="ql-list"
          type="button"
          value="ordered"
        >
          <ListOrdered aria-hidden="true" size={15} strokeWidth={2} />
        </button>
        {onUploadImage ? (
          <button aria-label={labels.image} className="ql-image" type="button">
            <ImageIcon aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        ) : null}
        {onUploadAttachment ? (
          <button
            aria-label={labels.attachFile}
            className="ql-attachment"
            type="button"
          >
            <Paperclip aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div className="rich-text-editor__surface" ref={editorHostRef} />
      {localizedAttachments.length > 0 ? (
        <div className="rich-text-editor__attachments">
          {localizedAttachments.map((attachment) => (
            <div
              className="rich-text-editor__attachment-card"
              key={attachment.token}
            >
              <div className="rich-text-editor__attachment-main">
                <span
                  aria-hidden="true"
                  className="rich-text-editor__attachment-icon"
                  data-kind={attachment.kind}
                >
                  {getAttachmentIconText(attachment.kind)}
                </span>
                <span className="rich-text-editor__attachment-name">
                  {attachment.displayName}
                </span>
              </div>
              <div className="rich-text-editor__attachment-actions">
                {attachment.isPreviewable ? (
                  <button
                    aria-label={attachment.previewLabel}
                    className="rich-text-editor__attachment-action"
                    type="button"
                    onClick={() => onPreviewAttachment?.(attachment)}
                  >
                    View
                  </button>
                ) : null}
                <button
                  aria-label={attachment.downloadLabel}
                  className="rich-text-editor__attachment-action"
                  type="button"
                  onClick={() => onDownloadAttachment?.(attachment)}
                >
                  Down
                </button>
                <button
                  aria-label={attachment.removeLabel}
                  className="rich-text-editor__attachment-action"
                  type="button"
                  onClick={() => {
                    const quill = quillRef.current;
                    if (quill) {
                      deleteAttachmentFromEditor(quill, attachment);
                    }
                    onRemoveAttachment?.(attachment);
                  }}
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function markdownToDelta(
  markdown: string,
  attachments: RichTextAttachment[],
): { ops: DeltaOperation[] } {
  const ops: DeltaOperation[] = [];
  const usedTokens = new Set<string>();
  const attachmentsByToken = new Map(
    attachments.map((attachment) => [attachment.markdownToken, attachment]),
  );
  const lines = normalizeLineEndings(markdown).split("\n");
  const imageLinePattern = /^!\[([^\]]*)\]\(([^)]+)\)$/;

  for (const line of lines) {
    const trimmedLine = line.trim();
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

    const parsedLine = parseMarkdownLine(line);
    ops.push(...parseBoldInline(parsedLine.text));
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

function deltaToMarkdown(
  operations: DeltaOperation[],
  attachments: RichTextAttachment[],
): string {
  const lines: string[] = [];
  let currentLine = "";
  let orderedIndex = 1;

  for (const operation of operations) {
    const attachment = getAttachmentInsert(operation, attachments);
    if (attachment) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }
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
        const formattedLine = formatBlockMarkdown(
          currentLine,
          operation.attributes,
          orderedIndex,
        );
        if (
          operation.attributes?.list === "ordered" &&
          currentLine.length > 0
        ) {
          orderedIndex += 1;
        } else if (operation.attributes?.list !== "ordered") {
          orderedIndex = 1;
        }
        lines.push(formattedLine);
        currentLine = "";
      }
    });
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return normalizeMarkdown(lines.join("\n"));
}

function applyMarkdownShortcuts(quill: Quill) {
  const selection = quill.getSelection();
  if (!selection || selection.length > 0) {
    return;
  }

  const [line, offset] = quill.getLine(selection.index) as [QuillLine, number];
  const lineText = line.domNode?.textContent ?? "";
  const lineStart = selection.index - offset;

  const blockShortcut = getBlockShortcut(lineText, offset);
  if (blockShortcut) {
    quill.deleteText(lineStart, blockShortcut.markerLength, "api");
    quill.formatLine(
      lineStart,
      1,
      blockShortcut.format,
      blockShortcut.value,
      "api",
    );
    return;
  }

  const prefix = quill.getText(lineStart, offset);
  const boldMatch = /\*\*([^*\n]+)\*\*$/.exec(prefix);
  if (!boldMatch || boldMatch.index == null) {
    return;
  }

  const innerText = boldMatch[1];
  const startIndex = lineStart + boldMatch.index;
  quill.deleteText(startIndex + 2 + innerText.length, 2, "api");
  quill.deleteText(startIndex, 2, "api");
  quill.formatText(startIndex, innerText.length, "bold", true, "api");
  quill.setSelection(startIndex + innerText.length, 0, "api");
}

function deleteAttachmentFromEditor(
  quill: Quill,
  targetAttachment: RichTextAttachment,
) {
  let index = 0;
  for (const operation of getQuillOperations(quill)) {
    const attachment = getAttachmentInsert(operation, [targetAttachment]);
    const length =
      typeof operation.insert === "string" ? operation.insert.length : 1;
    if (attachment?.token === targetAttachment.token) {
      quill.deleteText(index, length, "user");
      const nextCharacter = quill.getText(index, 1);
      if (nextCharacter === "\n") {
        quill.deleteText(index, 1, "user");
      }
      return;
    }
    index += length;
  }
}

function mergeMarkdownAttachments(
  markdown: string,
  attachments: RichTextAttachment[],
): string {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  const missingAttachments = attachments.filter(
    (attachment) => !normalizedMarkdown.includes(attachment.markdownToken),
  );

  if (missingAttachments.length === 0) {
    return normalizedMarkdown;
  }

  // 图片附件缺失时以 Markdown 图片占位符 ![displayName](token) 形式补回
  // （保证 Rust 硬约束：token 必须出现在 description 中）；非图片附件以
  // 裸 token 行补回（编辑器正文不显示，仅由底部卡片区承载）。
  const missingLines = missingAttachments.map((attachment) =>
    attachment.kind === "image" && attachment.imageSrc
      ? `![${attachment.displayName}](${attachment.markdownToken})`
      : attachment.markdownToken,
  );

  if (normalizedMarkdown.length === 0) {
    return missingLines.join("\n");
  }

  return `${normalizedMarkdown}\n\n${missingLines.join("\n")}`;
}

function getQuillOperations(quill: Quill): DeltaOperation[] {
  const contents = quill.getContents() as { ops?: DeltaOperation[] };
  return contents.ops ?? [];
}

function getAttachmentInsert(
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

function parseMarkdownLine(line: string): {
  text: string;
  attributes?: Record<string, unknown>;
} {
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
  if (/^\s*\d+\.\s+/.test(line)) {
    return {
      text: line.replace(/^\s*\d+\.\s+/, ""),
      attributes: { list: "ordered" },
    };
  }
  return { text: line };
}

function parseBoldInline(text: string): DeltaOperation[] {
  const operations: DeltaOperation[] = [];
  const boldPattern = /\*\*([^*\n]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      operations.push({ insert: text.slice(cursor, match.index) });
    }
    operations.push({ insert: match[1], attributes: { bold: true } });
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

  return attributes?.bold === true ? `**${text}**` : text;
}

function formatBlockMarkdown(
  line: string,
  attributes: Record<string, unknown> | undefined,
  orderedIndex: number,
): string {
  if (line.length === 0) {
    return "";
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

function getBlockShortcut(
  lineText: string,
  offset: number,
): { markerLength: number; format: string; value: unknown } | null {
  if (offset === 2 && lineText.startsWith("# ")) {
    return { markerLength: 2, format: "header", value: 1 };
  }
  if (offset === 3 && lineText.startsWith("## ")) {
    return { markerLength: 3, format: "header", value: 2 };
  }
  if (offset === 2 && /^[-*]\s/.test(lineText)) {
    return { markerLength: 2, format: "list", value: "bullet" };
  }
  if (offset === 3 && /^1\.\s/.test(lineText)) {
    return { markerLength: 3, format: "list", value: "ordered" };
  }
  return null;
}

function getAttachmentIconText(kind: RichTextAttachmentKind): string {
  switch (kind) {
    case "image":
      return "IMG";
    case "pdf":
      return "PDF";
    case "word":
      return "DOC";
    case "text":
      return "TXT";
    default:
      return "FILE";
  }
}

function normalizeMarkdown(markdown: string): string {
  return normalizeLineEndings(markdown)
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
