import { open, save } from "@tauri-apps/plugin-dialog";
import type { Dispatch, SetStateAction } from "react";

import {
  exportIssueAttachment,
  previewIssueAttachment,
  type IssueAttachmentRecord,
} from "./issue-commands";
import {
  type AttachmentPreviewState,
  type IssueFormState,
} from "./issue-activity-types";
import {
  buildDraftAttachment,
  toAttachmentPreviewState,
} from "./issue-form/issue-description-serializer";
import type { IssueAttachmentDraft } from "./issue-form/issue-description-editor";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];

interface UseIssueAttachmentsOptions {
  projectId: number;
  setForm: Dispatch<SetStateAction<IssueFormState>>;
  setAttachmentPreview: (preview: AttachmentPreviewState | null) => void;
  setDialogErrorMessage: (message: string | null) => void;
  t: Translate;
  messages: Messages;
}

export function useIssueAttachments({
  projectId,
  setForm,
  setAttachmentPreview,
  setDialogErrorMessage,
  t,
  messages,
}: UseIssueAttachmentsOptions) {
  async function selectAttachment(
    filter?: "image" | "file",
  ): Promise<IssueAttachmentDraft | null> {
    const selectedPath = await open({
      directory: false,
      multiple: false,
      title:
        filter === "image"
          ? messages.richText.image
          : messages.issues.addAttachment,
      filters:
        filter === "image"
          ? [
              {
                name: messages.issues.imageFilterName,
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
              },
            ]
          : undefined,
    });

    if (typeof selectedPath !== "string") {
      return null;
    }

    try {
      const attachment = await buildDraftAttachment(selectedPath);
      setForm((currentForm) => ({
        ...currentForm,
        attachments: [...currentForm.attachments, attachment],
      }));
      return attachment;
    } catch (error) {
      setDialogErrorMessage(getCommandErrorMessage(error, t));
      return null;
    }
  }

  function removeAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      attachments: currentForm.attachments.filter((item) =>
        "id" in attachment
          ? !("id" in item && item.id === attachment.id)
          : !("token" in item && item.token === attachment.token),
      ),
    }));
  }

  async function previewAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    try {
      const preview = await previewIssueAttachment(
        "id" in attachment
          ? {
              projectId,
              attachmentId: attachment.id,
            }
          : {
              projectId,
              sourcePath: attachment.sourcePath,
              displayName: attachment.displayName,
            },
      );
      setAttachmentPreview(toAttachmentPreviewState(preview));
    } catch (error) {
      setDialogErrorMessage(getCommandErrorMessage(error, t));
    }
  }

  async function downloadAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    const targetPath = await save({
      defaultPath: attachment.displayName,
      title: `Save ${attachment.displayName}`,
    });

    if (typeof targetPath !== "string") {
      return;
    }

    try {
      await exportIssueAttachment(
        "id" in attachment
          ? {
              projectId,
              attachmentId: attachment.id,
              targetPath,
            }
          : {
              projectId,
              sourcePath: attachment.sourcePath,
              displayName: attachment.displayName,
              targetPath,
            },
      );
    } catch (error) {
      setDialogErrorMessage(getCommandErrorMessage(error, t));
    }
  }

  return {
    selectAttachment,
    removeAttachment,
    previewAttachment,
    downloadAttachment,
  };
}
