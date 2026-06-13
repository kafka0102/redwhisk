import type { AgentProfileRecord } from "../settings/settings-commands";
import type { IssueRecord } from "./issue-commands";

export interface RunPromptSource {
  id:
    | "issue-description"
    | "issue-attachments"
    | "default-skill"
    | "prompt-template"
    | "app-instructions";
  label: string;
  content: string;
}

export interface RunPromptPreview {
  finalPrompt: string;
  sources: RunPromptSource[];
}

interface BuildRunPromptPreviewInput {
  issue: Pick<IssueRecord, "description" | "attachments">;
  profile: Pick<AgentProfileRecord, "defaultSkill" | "promptTemplate">;
}

const APP_INSTRUCTIONS =
  "你正在 RedWhisk 中处理一个本地 issue。优先依据给定 issue 描述完成任务；如果上下文不足，先明确缺口再继续行动。";

export function buildRunPromptPreview(
  input: BuildRunPromptPreviewInput,
): RunPromptPreview {
  const issueDescription = stripAttachmentTokens(input.issue.description).trim();
  const attachmentPaths =
    input.issue.attachments
      ?.map((attachment) => attachment.relativePath.trim())
      .filter((path) => path.length > 0) ?? [];
  const defaultSkill = input.profile.defaultSkill.trim();
  const promptTemplate = input.profile.promptTemplate.trim();
  const sources: RunPromptSource[] = [];

  if (issueDescription.length > 0) {
    sources.push({
      id: "issue-description",
      label: "Issue description",
      content: issueDescription,
    });
  }

  if (attachmentPaths.length > 0) {
    sources.push({
      id: "issue-attachments",
      label: "Issue attachments",
      content: attachmentPaths.join("\n"),
    });
  }

  if (defaultSkill.length > 0) {
    sources.push({
      id: "default-skill",
      label: "Default skill",
      content: defaultSkill,
    });
  }

  if (promptTemplate.length > 0) {
    sources.push({
      id: "prompt-template",
      label: "Prompt template",
      content: promptTemplate,
    });
  }

  sources.push({
    id: "app-instructions",
    label: "App instructions",
    content: APP_INSTRUCTIONS,
  });

  const finalPromptSections = [issueDescription];
  if (attachmentPaths.length > 0) {
    finalPromptSections.push([
      "Attachments:",
      ...attachmentPaths.map((path) => `- ${path}`),
      "请先读取这些附件文件，再开始处理当前 issue。",
    ].join("\n"));
  }

  return {
    finalPrompt: finalPromptSections.filter((section) => section.length > 0).join("\n\n"),
    sources,
  };
}

function stripAttachmentTokens(description: string): string {
  return description.replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "");
}
