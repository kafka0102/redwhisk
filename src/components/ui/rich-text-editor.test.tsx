import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RichTextEditor,
  type RichTextAttachment,
  type RichTextEditorLabels,
} from "./rich-text-editor";

const quillInstances = vi.hoisted(() => {
  const instances: Array<{
    getContents: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    root: HTMLElement;
    setContents: ReturnType<typeof vi.fn>;
  }> = [];
  return instances;
});

vi.mock("quill", () => {
  class FakeQuill {
    root = document.createElement("div");
    getContents = vi.fn(() => ({ ops: [] }));
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
    setContents = vi.fn();
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
  attachment: "Add attachment",
  bold: "Bold",
  heading: "Heading",
  normalText: "Normal text",
  headingOne: "Heading 1",
  headingTwo: "Heading 2",
  orderedList: "Ordered list",
  previewAttachment: (displayName) => `Preview ${displayName}`,
  downloadAttachment: (displayName) => `Download ${displayName}`,
  removeAttachment: (displayName) => `Remove ${displayName}`,
  unorderedList: "Unordered list",
};

describe("RichTextEditor", () => {
  beforeEach(() => {
    quillInstances.length = 0;
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
});
