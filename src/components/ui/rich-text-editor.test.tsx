import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Quill from "quill";

import {
  RichTextEditor,
  type RichTextAttachment,
  type RichTextEditorLabels,
} from "./rich-text-editor";
import { activateBlockFormat } from "./rich-text-editor-blocks";

const quillInstances = vi.hoisted(() => {
  const instances: Array<{
    getContents: ReturnType<typeof vi.fn>;
    insertEmbed: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    root: HTMLElement;
    setContents: ReturnType<typeof vi.fn>;
    deleteText: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    insertText: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
  }> = [];
  return instances;
});

vi.mock("quill", () => {
  class FakeQuill {
    contents = { ops: [] };
    root = document.createElement("div");
    getContents = vi.fn(() => this.contents);
    getLength = vi.fn(() => 1);
    getLine = vi.fn(() => [{ domNode: document.createElement("p") }, 0]);
    getSelection = vi.fn(() => ({ index: 0, length: 0 }));
    getText = vi.fn(() => "");
    insertEmbed = vi.fn();
    insertText = vi.fn();
    deleteText = vi.fn();
    formatLine = vi.fn();
    formatText = vi.fn();
    off = vi.fn();
    on = vi.fn();
    setContents = vi.fn((ops: []) => {
      this.contents = { ops };
    });
    setSelection = vi.fn();

    constructor(host: HTMLElement) {
      host.appendChild(this.root);
      quillInstances.push(this);
    }

    static import = vi.fn((name: string) => {
      if (name === "formats/image") {
        return class FakeImageBlot {
          static blotName = "image";
          static tagName = "IMG";
          static sanitize(url: string) {
            return url;
          }
        };
      }
      return undefined;
    });
    static register = vi.fn();
  }

  return { default: FakeQuill };
});

const labels: RichTextEditorLabels = {
  attachFile: "Add attachment",
  bold: "Bold",
  clearFormatting: "Clear formatting",
  codeBlock: "Code block",
  quote: "Quote",
  heading: "Heading",
  image: "Insert image",
  normalText: "Normal text",
  headingOne: "Heading 1",
  headingTwo: "Heading 2",
  orderedList: "Ordered list",
  previewAttachment: (displayName) => `Preview ${displayName}`,
  downloadAttachment: (displayName) => `Download ${displayName}`,
  removeAttachment: (displayName) => `Remove ${displayName}`,
  unorderedList: "Unordered list",
};

function createPasteEvent(plainText: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? plainText : ""),
    },
    configurable: true,
  });
  return event;
}

describe("RichTextEditor", () => {
  beforeEach(() => {
    quillInstances.length = 0;
  });

  it("renders formatting controls for code and cleanup actions", () => {
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Code block" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear formatting" }),
    ).toBeInTheDocument();
  });

  it("hides the placeholder while IME composition is active", async () => {
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(quillInstances[0]?.root).toBeTruthy());
    const editorRoot = quillInstances[0].root;
    editorRoot.dispatchEvent(new CompositionEvent("compositionstart"));

    expect(editorRoot).toHaveClass("rich-text-editor__input-pending");

    editorRoot.dispatchEvent(new CompositionEvent("compositionend"));

    await waitFor(() =>
      expect(editorRoot).not.toHaveClass("rich-text-editor__input-pending"),
    );
  });

  it("round-trips inline code and fenced code blocks as markdown", async () => {
    const handleChange = vi.fn();
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value={"Use `pnpm test`\n```\nconst x = 1;\n```"}
        onChange={handleChange}
      />,
    );

    await waitFor(() =>
      expect(quillInstances[0]?.setContents).toHaveBeenCalled(),
    );
    const setContentsCalls = quillInstances[0].setContents.mock.calls;
    const setContentsPayload =
      setContentsCalls[setContentsCalls.length - 1]?.[0];
    expect(setContentsPayload).toContainEqual({
      insert: "pnpm test",
      attributes: { code: true },
    });
    expect(setContentsPayload).toContainEqual({ insert: "const x = 1;" });
    expect(setContentsPayload).toContainEqual({
      insert: "\n",
      attributes: { "code-block": true },
    });

    quillInstances[0].getContents.mockReturnValue({
      ops: [
        { insert: "Use " },
        { insert: "pnpm test", attributes: { code: true } },
        { insert: "\n" },
        { insert: "const x = 1;" },
        { insert: "\n", attributes: { "code-block": true } },
      ],
    });
    const textChangeHandler = quillInstances[0].on.mock.calls.find(
      ([eventName]) => eventName === "text-change",
    )?.[1];
    textChangeHandler?.({}, {}, "user");

    expect(handleChange).toHaveBeenLastCalledWith(
      "Use `pnpm test`\n```\nconst x = 1;\n```",
    );
  });

  it("round-trips blockquote lines as markdown", async () => {
    const handleChange = vi.fn();
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value={"> quoted text"}
        onChange={handleChange}
      />,
    );

    await waitFor(() =>
      expect(quillInstances[0]?.setContents).toHaveBeenCalled(),
    );
    const setContentsCalls = quillInstances[0].setContents.mock.calls;
    const setContentsPayload =
      setContentsCalls[setContentsCalls.length - 1]?.[0];
    expect(setContentsPayload).toContainEqual({
      insert: "\n",
      attributes: { blockquote: true },
    });

    quillInstances[0].getContents.mockReturnValue({
      ops: [
        { insert: "quoted text" },
        { insert: "\n", attributes: { blockquote: true } },
      ],
    });
    const textChangeHandler = quillInstances[0].on.mock.calls.find(
      ([eventName]) => eventName === "text-change",
    )?.[1];
    textChangeHandler?.({}, {}, "user");

    expect(handleChange).toHaveBeenLastCalledWith("> quoted text");
  });

  it("uses Quill image embeds and React attachment actions", async () => {
    const user = userEvent.setup();
    const screenshot: RichTextAttachment = {
      token: "image-1",
      displayName: "screenshot.png",
      kind: "image",
      markdownToken: "{{issue-attachment-temp:image-1}}",
      isPreviewable: true,
      imageSrc: "asset://screenshot.png",
    };
    const spec: RichTextAttachment = {
      token: "file-1",
      displayName: "spec.md",
      kind: "text",
      markdownToken: "{{issue-attachment-temp:file-1}}",
      isPreviewable: true,
      imageSrc: null,
    };
    const handlePreviewAttachment = vi.fn();
    const handleDownloadAttachment = vi.fn();
    const handleRemoveAttachment = vi.fn();

    render(
      <RichTextEditor
        ariaLabel="Description"
        attachments={[screenshot, spec]}
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
        onDownloadAttachment={handleDownloadAttachment}
        onPreviewAttachment={handlePreviewAttachment}
        onRemoveAttachment={handleRemoveAttachment}
      />,
    );

    await waitFor(() =>
      expect(quillInstances[0]?.setContents).toHaveBeenCalled(),
    );
    const setContentsCalls = quillInstances[0].setContents.mock.calls;
    const setContentsPayload =
      setContentsCalls[setContentsCalls.length - 1]?.[0];

    expect(setContentsPayload).toContainEqual({
      insert: { image: "asset://screenshot.png" },
      attributes: { alt: "screenshot.png" },
    });
    expect(JSON.stringify(setContentsPayload)).not.toContain("rwAttachment");

    await user.click(
      screen.getByRole("button", { name: "Preview screenshot.png" }),
    );
    await user.click(screen.getByRole("button", { name: "Download spec.md" }));
    await user.click(
      screen.getByRole("button", { name: "Remove screenshot.png" }),
    );

    expect(handlePreviewAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ token: "image-1" }),
    );
    expect(handleDownloadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ token: "file-1" }),
    );
    expect(handleRemoveAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ token: "image-1" }),
    );
  });

  it("embeds images inline and keeps non-image attachments out of the editor body", async () => {
    const imageAttachment: RichTextAttachment = {
      token: "img-1",
      displayName: "pic.png",
      kind: "image",
      markdownToken: "{{issue-attachment-temp:img-1}}",
      isPreviewable: true,
      imageSrc: "asset://pic.png",
    };
    const fileAttachment: RichTextAttachment = {
      token: "doc-1",
      displayName: "notes.md",
      kind: "text",
      markdownToken: "{{issue-attachment-temp:doc-1}}",
      isPreviewable: true,
      imageSrc: null,
    };

    render(
      <RichTextEditor
        ariaLabel="Description"
        attachments={[imageAttachment, fileAttachment]}
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(quillInstances[0]?.setContents).toHaveBeenCalled(),
    );
    const setContentsCalls = quillInstances[0].setContents.mock.calls;
    const setContentsPayload =
      setContentsCalls[setContentsCalls.length - 1]?.[0];

    // 图片附件应作为 image embed 进入编辑器正文。
    expect(setContentsPayload).toContainEqual({
      insert: { image: "asset://pic.png" },
      attributes: { alt: "pic.png" },
    });
    // 非图片附件的 token 不应作为可见文本进入编辑器正文。
    expect(JSON.stringify(setContentsPayload)).not.toContain(
      "{{issue-attachment-temp:doc-1}}",
    );

    // 底部卡片区应同时承载图片与文件附件。
    expect(screen.getByText("pic.png")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("does not reset editor contents when only hidden file attachment tokens are missing", async () => {
    const fileAttachment: RichTextAttachment = {
      token: "doc-1",
      displayName: "notes.md",
      kind: "text",
      markdownToken: "{{issue-attachment-temp:doc-1}}",
      isPreviewable: true,
      imageSrc: null,
    };
    const handleChange = vi.fn();

    const { rerender } = render(
      <RichTextEditor
        ariaLabel="Description"
        attachments={[fileAttachment]}
        labels={labels}
        placeholder="Describe"
        value="Draft"
        onChange={handleChange}
      />,
    );

    await waitFor(() => {
      expect(quillInstances[0]?.setContents).toHaveBeenCalledTimes(1);
    });

    quillInstances[0].getContents.mockReturnValue({
      ops: [{ insert: "Draft update" }, { insert: "\n" }],
    });

    rerender(
      <RichTextEditor
        ariaLabel="Description"
        attachments={[fileAttachment]}
        labels={labels}
        placeholder="Describe"
        value="Draft update"
        onChange={handleChange}
      />,
    );

    expect(quillInstances[0].setContents).toHaveBeenCalledTimes(1);
  });

  it("strips formatting and trims pasted plain text", async () => {
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(quillInstances[0]?.root).toBeTruthy());
    const editorRoot = quillInstances[0].root;
    const event = createPasteEvent("  hello world  ");
    editorRoot.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(quillInstances[0].insertText).toHaveBeenCalledWith(
      0,
      "hello world",
      "user",
    );
    expect(quillInstances[0].setSelection).toHaveBeenCalledWith(
      "hello world".length,
      0,
      "user",
    );
  });

  it("replaces the current selection with trimmed pasted text", async () => {
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(quillInstances[0]?.root).toBeTruthy());
    quillInstances[0].getSelection.mockReturnValue({ index: 4, length: 3 });
    const editorRoot = quillInstances[0].root;
    const event = createPasteEvent("  new  ");
    editorRoot.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(quillInstances[0].deleteText).toHaveBeenCalledWith(4, 3, "user");
    expect(quillInstances[0].insertText).toHaveBeenCalledWith(4, "new", "user");
    expect(quillInstances[0].setSelection).toHaveBeenCalledWith(
      4 + "new".length,
      0,
      "user",
    );
  });

  it("leaves image-only paste to the default pipeline", async () => {
    render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(quillInstances[0]?.root).toBeTruthy());
    const editorRoot = quillInstances[0].root;
    const event = createPasteEvent("");
    editorRoot.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(quillInstances[0].insertText).not.toHaveBeenCalled();
  });
});

interface FakeBlockQuillOptions {
  selection?: { index: number; length: number } | null;
  formats?: Record<string, unknown>;
  lineLength?: number;
  lineOffset?: number;
}

function createFakeBlockQuill(options: FakeBlockQuillOptions) {
  return {
    getSelection: vi.fn(() => options.selection ?? null),
    getFormat: vi.fn(() => options.formats ?? {}),
    formatLine: vi.fn(),
    insertText: vi.fn(),
    setSelection: vi.fn(),
    getLine: vi.fn(() => [
      { length: () => options.lineLength ?? 1 },
      options.lineOffset ?? 0,
    ]),
  };
}

describe("activateBlockFormat", () => {
  it("inserts an exit line below when activating blockquote with no selection", () => {
    const fake = createFakeBlockQuill({
      selection: { index: 0, length: 0 },
      formats: {},
      lineLength: 1,
      lineOffset: 0,
    });

    activateBlockFormat(fake as unknown as Quill, "blockquote");

    expect(fake.formatLine).toHaveBeenCalledWith(
      0,
      1,
      "blockquote",
      true,
      "user",
    );
    expect(fake.insertText).toHaveBeenCalledWith(1, "\n", "user");
    expect(fake.formatLine).toHaveBeenCalledWith(
      1,
      1,
      "blockquote",
      false,
      "user",
    );
    expect(fake.setSelection).toHaveBeenCalledWith(0, 0, "user");
  });

  it("inserts an exit line below when activating code-block on a non-empty line", () => {
    const fake = createFakeBlockQuill({
      selection: { index: 2, length: 0 },
      formats: {},
      lineLength: 6,
      lineOffset: 2,
    });

    activateBlockFormat(fake as unknown as Quill, "code-block");

    expect(fake.formatLine).toHaveBeenCalledWith(
      2,
      1,
      "code-block",
      true,
      "user",
    );
    expect(fake.insertText).toHaveBeenCalledWith(6, "\n", "user");
    expect(fake.formatLine).toHaveBeenCalledWith(
      6,
      1,
      "code-block",
      false,
      "user",
    );
    expect(fake.setSelection).toHaveBeenCalledWith(2, 0, "user");
  });

  it("toggles the format off without an exit line when already active", () => {
    const fake = createFakeBlockQuill({
      selection: { index: 0, length: 0 },
      formats: { blockquote: true },
    });

    activateBlockFormat(fake as unknown as Quill, "blockquote");

    expect(fake.formatLine).toHaveBeenCalledWith(
      0,
      1,
      "blockquote",
      false,
      "user",
    );
    expect(fake.insertText).not.toHaveBeenCalled();
    expect(fake.setSelection).not.toHaveBeenCalled();
  });

  it("does not insert an exit line when a selection is present", () => {
    const fake = createFakeBlockQuill({
      selection: { index: 0, length: 5 },
      formats: {},
    });

    activateBlockFormat(fake as unknown as Quill, "blockquote");

    expect(fake.formatLine).toHaveBeenCalledWith(
      0,
      5,
      "blockquote",
      true,
      "user",
    );
    expect(fake.insertText).not.toHaveBeenCalled();
  });
});
