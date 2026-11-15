import { uploadIssueHostAttachment } from "./host-attachment-commands";
import {
  createHostAttachmentController,
  type HostAttachmentController,
  type HostMode,
  type HostProvider,
  type HostSource,
} from "./host-attachment-upload";

let projectId = 0;

const session = createHostAttachmentController({
  upload: async (input) => {
    const result = await uploadIssueHostAttachment({
      projectId,
      tempToken: input.tempToken,
      sourcePath: input.sourcePath,
      displayName: input.displayName,
    });
    return result.markdown;
  },
  createIssue: async () => undefined,
  updateIssue: async () => undefined,
  deleteHost: async () => undefined,
});

export function bindHostAttachmentProject(nextProjectId: number): void {
  projectId = nextProjectId;
}

export function hostAttachmentSession(): HostAttachmentController {
  return session;
}

export function publishIssueDialogMode(mode: HostMode): void {
  session.setMode(mode);
}

export function publishHostAttachmentSource(
  source: HostSource,
  provider: HostProvider,
): void {
  void session.setCreateSource(source, provider);
}
