import { open, save } from "@tauri-apps/plugin-dialog";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

import {
  bindHostAttachmentProject,
  hostAttachmentSession,
} from "./issue-form/host-attachment-session";
import { descriptionWithoutToken } from "./issue-form/host-attachment-upload";
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
import { bindMoreImages } from "./issue-form/issue-more-images";
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

interface SelectedImageBatch {
  paths: string[];
  taken: number;
  hasMoreImages: boolean;
}

export function uniqueImagePaths(selected: unknown): string[] {
  const paths = Array.isArray(selected)
    ? selected.filter((path): path is string => typeof path === "string")
    : typeof selected === "string"
      ? [selected]
      : [];
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) {
      return false;
    }
    seen.add(path);
    return true;
  });
}

export function useIssueAttachments({
  projectId,
  setForm,
  setAttachmentPreview,
  setDialogErrorMessage,
  t,
  messages,
}: UseIssueAttachmentsOptions) {
  bindHostAttachmentProject(projectId);
  const imageBatchRef = useRef<SelectedImageBatch | null>(null);
  const hasMoreImagesRef = useRef(false);

  async function selectAttachment(
    filter?: "image" | "file",
  ): Promise<IssueAttachmentDraft | null> {
    if (filter === "image") {
      return selectNextImage();
    }

    const selectedPath = await open({
      directory: false,
      multiple: false,
      title: messages.issues.addAttachment,
      filters: undefined,
    });

    if (typeof selectedPath !== "string") {
      return null;
    }

    return saveSelectedAttachment(selectedPath);
  }

  async function selectNextImage(): Promise<IssueAttachmentDraft | null> {
    const batch = imageBatchRef.current;
    if (batch && batch.taken < batch.paths.length) {
      const sourcePath = batch.paths[batch.taken];
      batch.taken += 1;
      batch.hasMoreImages = batch.taken < batch.paths.length;
      const attachment = await saveSelectedAttachment(sourcePath);
      markMoreImages(Boolean(attachment) && batch.hasMoreImages);
      return attachment;
    }

    const selected = await open({
      directory: false,
      multiple: true,
      title: messages.richText.image,
      filters: [
        {
          name: messages.issues.imageFilterName,
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        },
      ],
    });
    const paths = uniqueImagePaths(selected);
    if (paths.length === 0) {
      imageBatchRef.current = null;
      return null;
    }

    imageBatchRef.current = {
      paths,
      taken: 1,
      hasMoreImages: paths.length > 1,
    };
    const attachment = await saveSelectedAttachment(paths[0]);
    if (attachment) {
      markMoreImages(paths.length > 1);
    }
    return attachment;
  }

  async function saveSelectedAttachment(
    sourcePath: string,
  ): Promise<IssueAttachmentDraft | null> {
    try {
      const attachment = await buildDraftAttachment(sourcePath);
      const pending = hostAttachmentSession().selectFile({
        token: attachment.token,
        displayName: attachment.displayName,
        sourcePath: attachment.sourcePath,
      });
      const hostStatus = hostAttachmentSession().status(attachment.token);
      setForm((currentForm) => ({
        ...currentForm,
        attachments: [
          ...currentForm.attachments,
          hostStatus ? { ...attachment, hostStatus } : attachment,
        ],
      }));
      void pending.then(() => {
        const nextStatus = hostAttachmentSession().status(attachment.token);
        if (!nextStatus) {
          return;
        }
        setForm((currentForm) => ({
          ...currentForm,
          attachments: currentForm.attachments.map((item) =>
            "token" in item && item.token === attachment.token
              ? { ...item, hostStatus: nextStatus }
              : item,
          ),
        }));
      });
      return attachment;
    } catch (error) {
      imageBatchRef.current = null;
      markMoreImages(false);
      setDialogErrorMessage(getCommandErrorMessage(error, t));
      return null;
    }
  }

  function removeAttachment(
    attachment: IssueAttachmentRecord | IssueAttachmentDraft,
  ) {
    if (!("id" in attachment)) {
      hostAttachmentSession().removeFile(attachment.token);
    }
    setForm((currentForm) => ({
      ...currentForm,
      description:
        "token" in attachment
          ? descriptionWithoutToken(currentForm.description, attachment.token)
          : currentForm.description,
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

  function markMoreImages(hasMoreImages: boolean) {
    hasMoreImagesRef.current = hasMoreImages;
  }

  useEffect(() => {
    bindMoreImages(selectAttachment, hasMoreImagesRef);
  });

  return {
    selectAttachment,
    removeAttachment,
    previewAttachment,
    downloadAttachment,
  };
}
