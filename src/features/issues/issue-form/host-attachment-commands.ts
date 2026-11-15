import { invokeCommand } from "../../../shared/commands/command-client";

export interface UploadIssueHostAttachmentInput {
  projectId: number;
  tempToken: string;
  sourcePath: string;
  displayName: string;
}

export interface UploadIssueHostAttachmentResult {
  markdown: string;
}

export function uploadIssueHostAttachment(
  input: UploadIssueHostAttachmentInput,
): Promise<UploadIssueHostAttachmentResult> {
  return invokeCommand<UploadIssueHostAttachmentResult>(
    "upload_issue_host_attachment",
    { input },
  );
}
