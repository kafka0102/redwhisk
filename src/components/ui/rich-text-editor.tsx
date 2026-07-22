import { useEffect, useMemo, useRef } from "react";
import {
  Bold,
  Image as ImageIcon,
  List,
  ListOrdered,
  Paintbrush,
  Paperclip,
  Quote,
  SquareCode,
} from "lucide-react";
import Quill from "quill";
import "quill/dist/quill.snow.css";

import { activateBlockFormat, type QuillLine } from "./rich-text-editor-blocks";
import {
  deltaToMarkdown,
  getAttachmentInsert,
  markdownToDelta,
  mergeMarkdownAttachments,
  normalizeMarkdown,
  type DeltaOperation,
} from "./rich-text-editor-markdown";

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
  clearFormatting: string;
  codeBlock: string;
  quote: string;
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
            blockquote: () => {
              const quill = quillRef.current;
              if (quill) {
                activateBlockFormat(quill, "blockquote");
              }
            },
            "code-block": () => {
              const quill = quillRef.current;
              if (quill) {
                activateBlockFormat(quill, "code-block");
              }
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

    let isComposing = false;
    const hidePlaceholderForInput = () => {
      quill.root.classList.add("rich-text-editor__input-pending");
    };
    const restorePlaceholderAfterInput = () => {
      if (!isComposing) {
        quill.root.classList.remove("rich-text-editor__input-pending");
      }
    };
    const schedulePlaceholderRestore = () => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(restorePlaceholderAfterInput);
      } else {
        window.setTimeout(restorePlaceholderAfterInput, 0);
      }
    };
    const handleCompositionStart = () => {
      isComposing = true;
      hidePlaceholderForInput();
    };
    const handleCompositionEnd = () => {
      isComposing = false;
      schedulePlaceholderRestore();
    };
    const handleBeforeInput = () => {
      hidePlaceholderForInput();
    };
    const handleInput = () => {
      schedulePlaceholderRestore();
    };
    const handleBlur = () => {
      isComposing = false;
      restorePlaceholderAfterInput();
    };
    // 粘贴时丢弃 HTML/富文本格式（只取纯文本并去首尾空白），避免外部样式污染
    // 编辑器；再把纯文本按 Markdown 解析为 delta 插入，使加粗 / 列表 / 标题 /
    // 引用 / 代码等标记在粘贴当下即渲染，与保存后重新打开的渲染一致。监听器
    // 挂在 quill.root 的父节点上并以捕获阶段先于 Quill 自带的 onCapturePaste
    // 执行，preventDefault 后 Quill 会在 defaultPrevented 检查处直接退出，不
    // 再走其 clipboard 转换链路。
    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) {
        return;
      }
      const rawText = clipboardData.getData("text/plain");
      if (rawText.length === 0) {
        // 没有纯文本（例如粘贴图片）时不拦截，交回默认链路处理。
        return;
      }
      event.preventDefault();
      const trimmedText = rawText.trim();
      if (trimmedText.length === 0) {
        return;
      }
      const selection = quill.getSelection();
      const index = selection
        ? selection.index
        : Math.max(quill.getLength() - 1, 0);
      if (selection && selection.length > 0) {
        quill.deleteText(selection.index, selection.length, "user");
      }
      // 代码块是行级格式，属性挂在换行上。自定义粘贴若只插入无属性换行，
      // 中间行会变成普通段落，仅最后一行承接原代码块换行——表现为“只剩末行是代码块”。
      const activeFormats = quill.getFormat(index) as Record<string, unknown>;
      const contentOps = buildPasteContent(trimmedText, activeFormats);
      quill.updateContents([{ retain: index }, ...contentOps], "user");
      quill.setSelection(index + measureDeltaLength(contentOps), 0, "user");
    };

    quill.root.addEventListener("compositionstart", handleCompositionStart);
    quill.root.addEventListener("compositionend", handleCompositionEnd);
    quill.root.addEventListener("beforeinput", handleBeforeInput);
    quill.root.addEventListener("input", handleInput);
    quill.root.addEventListener("blur", handleBlur);
    editorHostElement.addEventListener("paste", handlePaste, true);

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
      quill.root.removeEventListener(
        "compositionstart",
        handleCompositionStart,
      );
      quill.root.removeEventListener("compositionend", handleCompositionEnd);
      quill.root.removeEventListener("beforeinput", handleBeforeInput);
      quill.root.removeEventListener("input", handleInput);
      quill.root.removeEventListener("blur", handleBlur);
      editorHostElement.removeEventListener("paste", handlePaste, true);
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
          aria-label={labels.quote}
          className="ql-blockquote"
          type="button"
        >
          <Quote aria-hidden="true" size={15} strokeWidth={2} />
        </button>
        <button
          aria-label={labels.codeBlock}
          className="ql-code-block"
          type="button"
        >
          <SquareCode aria-hidden="true" size={15} strokeWidth={2} />
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
        <button
          aria-label={labels.clearFormatting}
          className="ql-clean"
          type="button"
        >
          <Paintbrush aria-hidden="true" size={15} strokeWidth={2} />
        </button>
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

function getQuillOperations(quill: Quill): DeltaOperation[] {
  const contents = quill.getContents() as { ops?: DeltaOperation[] };
  return contents.ops ?? [];
}

// 将粘贴文本转为可插入的 delta 片段。
// - 光标已在代码块内：按纯文本逐行插入，并为每个换行挂上 code-block，避免
//   Markdown 解析改写代码内容，也避免中间行丢失代码块格式。
// - 其余位置：按 Markdown 解析为文档 delta，再剥离末尾代表文档结束的普通换行
//   （无块级属性的 "\n"），使其作为片段插入光标处而非整体替换。附件传空数组：
//   粘贴属外部内容，不与既有附件 token 绑定，仅渲染 Markdown 排版。
function buildPasteContent(
  markdown: string,
  activeFormats: Record<string, unknown>,
): DeltaOperation[] {
  if (isActiveCodeBlockFormat(activeFormats)) {
    return buildCodeBlockPasteContent(markdown);
  }
  const { ops } = markdownToDelta(markdown, []);
  return stripTrailingPlainNewline(ops);
}

function isActiveCodeBlockFormat(formats: Record<string, unknown>): boolean {
  return formats["code-block"] !== undefined && formats["code-block"] !== false;
}

// 代码块内粘贴：保留字面内容，不为 Markdown 标记做二次解析；每个行间换行都带
// code-block，使多行粘贴整段保持在同一代码块中。末行不追加换行，由光标处既有
// 的代码块换行承接，避免多出空代码行。
function buildCodeBlockPasteContent(text: string): DeltaOperation[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const ops: DeltaOperation[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 0) {
      ops.push({ insert: line });
    }
    if (index < lines.length - 1) {
      ops.push({ insert: "\n", attributes: { "code-block": true } });
    }
  }
  return ops;
}

// 末尾若是无属性的普通换行（文档结束符），剥掉它，避免在光标处多出一个空行；
// 末尾若是带块级格式的换行（如列表项 / 标题），保留它，由其后既有换行承接，
// 使光标落在内容下方的新行。与 Quill clipboard.convert 的末尾换行处理一致。
function stripTrailingPlainNewline(ops: DeltaOperation[]): DeltaOperation[] {
  if (ops.length === 0) {
    return ops;
  }
  const last = ops[ops.length - 1];
  if (
    typeof last.insert === "string" &&
    last.insert === "\n" &&
    !last.attributes
  ) {
    return ops.slice(0, -1);
  }
  return ops;
}

// 累加 delta 片段的字符长度，用于粘贴后定位光标：字符串 insert 取其长度，embed
// 计 1，其余（retain / delete）不在粘贴片段中出现。
function measureDeltaLength(ops: DeltaOperation[]): number {
  return ops.reduce((total, op) => {
    if (typeof op.insert === "string") {
      return total + op.insert.length;
    }
    if (op.insert != null) {
      return total + 1;
    }
    return total;
  }, 0);
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
