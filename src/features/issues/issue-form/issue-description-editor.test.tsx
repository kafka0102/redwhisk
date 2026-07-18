import { convertFileSrc } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";

import {
  IssueDescriptionEditor,
  type IssueAttachmentDraft,
} from "./issue-description-editor";
import type { IssueAttachmentRecord } from "../issue-commands";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("@/components/ui/rich-text-editor", () => ({
  RichTextEditor: ({
    ariaLabel,
    attachments = [],
    onDownloadAttachment,
    onPreviewAttachment,
    onRemoveAttachment,
    onUploadAttachment,
    value,
  }: {
    ariaLabel: string;
    attachments?: Array<{
      token: string;
      displayName: string;
      kind: string;
      imageSrc?: string | null;
      isPreviewable: boolean;
    }>;
    onDownloadAttachment?: (attachment: unknown) => void;
    onPreviewAttachment?: (attachment: unknown) => void;
    onRemoveAttachment?: (attachment: unknown) => void;
    onUploadAttachment?: () => Promise<unknown>;
    value: string;
  }) => (
    <div>
      <textarea aria-label={ariaLabel} readOnly value={value} />
      <button
        aria-label="upload"
        type="button"
        onClick={() => {
          void (async () => {
            const attachment = await onUploadAttachment?.();
            if (attachment) {
              onPreviewAttachment?.(attachment);
              onDownloadAttachment?.(attachment);
              onRemoveAttachment?.(attachment);
            }
          })();
        }}
      >
        upload
      </button>
      {attachments.map((attachment) => (
        <div key={attachment.token}>
          <span>{attachment.displayName}</span>
          {attachment.kind === "image" && attachment.imageSrc ? (
            <img alt={attachment.displayName} src={attachment.imageSrc} />
          ) : null}
          {attachment.isPreviewable ? (
            <button
              aria-label={`preview ${attachment.displayName}`}
              type="button"
              onClick={() => onPreviewAttachment?.(attachment)}
            >
              preview
            </button>
          ) : null}
          <button
            aria-label={`download ${attachment.displayName}`}
            type="button"
            onClick={() => onDownloadAttachment?.(attachment)}
          >
            download
          </button>
          <button
            aria-label={`remove ${attachment.displayName}`}
            type="button"
            onClick={() => onRemoveAttachment?.(attachment)}
          >
            remove
          </button>
        </div>
      ))}
    </div>
  ),
}));

const convertFileSrcMock = vi.mocked(convertFileSrc);

describe("IssueDescriptionEditor", () => {
  beforeEach(() => {
    convertFileSrcMock.mockReset();
    convertFileSrcMock.mockImplementation((path) => `asset://${path}`);
  });

  it("renders image attachments with a converted file source", () => {
    const attachment: IssueAttachmentDraft = {
      token: "draft-token",
      displayName: "screenshot.png",
      sourcePath: "/tmp/screenshot.png",
      absolutePath: "/tmp/screenshot.png",
      kind: "image",
      isPreviewable: true,
    };

    renderIssueDescriptionEditor({ attachments: [attachment] });

    expect(convertFileSrcMock).toHaveBeenCalledWith("/tmp/screenshot.png");
    expect(screen.getByRole("img", { name: "screenshot.png" })).toHaveAttribute(
      "src",
      "asset:///tmp/screenshot.png",
    );
  });

  it("resolves a newly uploaded attachment before parent props refresh", async () => {
    const user = userEvent.setup();
    const attachment: IssueAttachmentDraft = {
      token: "draft-token",
      displayName: "screenshot.png",
      sourcePath: "/tmp/screenshot.png",
      absolutePath: "/tmp/screenshot.png",
      kind: "image",
      isPreviewable: true,
    };
    const handleSelectAttachment = vi.fn().mockResolvedValue(attachment);
    const handlePreviewAttachment = vi.fn();
    const handleDownloadAttachment = vi.fn();
    const handleRemoveAttachment = vi.fn();

    renderIssueDescriptionEditor({
      attachments: [],
      onDownloadAttachment: handleDownloadAttachment,
      onPreviewAttachment: handlePreviewAttachment,
      onRemoveAttachment: handleRemoveAttachment,
      onSelectAttachment: handleSelectAttachment,
    });

    await user.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => {
      expect(handleSelectAttachment).toHaveBeenCalledTimes(1);
      expect(handlePreviewAttachment).toHaveBeenCalledWith(attachment);
      expect(handleDownloadAttachment).toHaveBeenCalledWith(attachment);
      expect(handleRemoveAttachment).toHaveBeenCalledWith(attachment);
    });
  });
});

function renderIssueDescriptionEditor({
  attachments = [],
  onDownloadAttachment = vi.fn(),
  onPreviewAttachment = vi.fn(),
  onRemoveAttachment = vi.fn(),
  onSelectAttachment = vi.fn().mockResolvedValue(null),
}: {
  attachments?: IssueAttachmentDraft[];
  onDownloadAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onPreviewAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onRemoveAttachment?: (
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) => void;
  onSelectAttachment?: () => Promise<IssueAttachmentDraft | null>;
}) {
  return render(
    <I18nProvider>
      <IssueDescriptionEditor
        ariaLabel="Description"
        attachments={attachments}
        placeholder="Describe"
        value=""
        onChange={vi.fn()}
        onDownloadAttachment={onDownloadAttachment}
        onPreviewAttachment={onPreviewAttachment}
        onRemoveAttachment={onRemoveAttachment}
        onSelectAttachment={onSelectAttachment}
      />
    </I18nProvider>,
  );
}
