import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RichTextEditor,
  type RichTextAttachment,
  type RichTextEditorLabels,
} from "./rich-text-editor";

const labels: RichTextEditorLabels = {
  attachFile: "Add attachment",
  bold: "Bold",
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

describe("RichTextEditor image embed", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("preserves asset:// image source after upload instead of sanitizing it to //:0", async () => {
    const imageSrc =
      "asset://localhost/%2FUsers%2Fme%2F.redwhisk%2Fscreenshot.png";
    const imageAttachment: RichTextAttachment = {
      token: "img-asset",
      displayName: "screenshot.png",
      kind: "image",
      markdownToken: "{{issue-attachment-temp:img-asset}}",
      isPreviewable: true,
      imageSrc,
    };
    const onUploadImage = vi.fn().mockResolvedValue(imageAttachment);

    const { container } = render(
      <RichTextEditor
        ariaLabel="Description"
        labels={labels}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
        onUploadImage={onUploadImage}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".ql-editor")).toBeTruthy();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Insert image" }).click();
      await vi.waitFor(() => expect(onUploadImage).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const img = container.querySelector<HTMLImageElement>(".ql-editor img");
    expect(img).not.toBeNull();
    // Quill 内置 image blot 会把 asset:// 清洗成 //:0；自定义 blot 必须保留原 src。
    expect(img?.getAttribute("src")).toBe(imageSrc);
  });
});
