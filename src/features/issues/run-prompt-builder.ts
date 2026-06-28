import type { AgentProfileRecord } from "../settings/settings-commands";
import { parseDefaultSkills } from "../settings/agent-profile-skills";
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
  issue: Pick<IssueRecord, "title" | "description" | "attachments">;
  profile: Pick<AgentProfileRecord, "defaultSkill" | "promptTemplate">;
  selectedWorkflowSkill?: string | null;
}

const APP_INSTRUCTIONS =
  "你正在 RedWhisk 中处理一个本地 issue。优先依据给定 issue 描述完成任务；如果上下文不足，先明确缺口再继续行动。";

export function buildRunPromptPreview(
  input: BuildRunPromptPreviewInput,
): RunPromptPreview {
  const issueTitle = input.issue.title.trim();
  const issueDescription = stripAttachmentTokens(
    input.issue.description,
  ).trim();
  const attachmentPaths =
    input.issue.attachments
      ?.map((attachment) => attachment.relativePath.trim())
      .filter((path) => path.length > 0) ?? [];
  const configuredSkills = parseDefaultSkills(input.profile.defaultSkill);
  const selectedWorkflowSkill = input.selectedWorkflowSkill ?? null;
  const defaultSkills =
    selectedWorkflowSkill === null
      ? configuredSkills
      : selectedWorkflowSkill.trim().length > 0
        ? [selectedWorkflowSkill.trim()]
        : [];
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

  if (defaultSkills.length > 0) {
    sources.push({
      id: "default-skill",
      label: "Default skills",
      content: defaultSkills.join("\n"),
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

  const finalPromptSections: string[] = [];

  if (defaultSkills.length > 0) {
    finalPromptSections.push(
      ...defaultSkills.map((defaultSkill) =>
        buildSkillInstruction(defaultSkill, {
          title: issueTitle,
          description: issueDescription,
        }),
      ),
    );
  }

  if (issueDescription.length > 0) {
    finalPromptSections.push(issueDescription);
  }

  if (attachmentPaths.length > 0) {
    finalPromptSections.push(
      [
        "Attachments:",
        ...attachmentPaths.map((path) => `- ${path}`),
        "请先读取这些附件文件，再开始处理当前 issue。",
      ].join("\n"),
    );
  }

  return {
    finalPrompt: finalPromptSections
      .filter((section) => section.length > 0)
      .join("\n\n"),
    sources,
  };
}

function stripAttachmentTokens(description: string): string {
  return (
    description
      // 剥离裸 token 行：单独成行的 {{issue-attachment...}}
      .replace(/^\s*\{\{issue-attachment(?:-temp)?:[^}]+\}\}\s*$/gm, "")
      // 剥离图片占位符行：![alt]({{issue-attachment...}})（agent 不需要在描述文本里
      // 看到图片占位符，附件路径仍由 attachmentPaths 单独注入）
      .replace(
        /^\s*!\[[^\]]*\]\(\{\{issue-attachment(?:-temp)?:[^}]+\}\}\)\s*$/gm,
        "",
      )
  );
}

function buildSkillInstruction(
  skillName: string,
  issue: Pick<IssueRecord, "title" | "description">,
): string {
  return containsChinese(`${issue.title}\n${issue.description}`)
    ? `使用skill ${skillName} 执行任务：`
    : `using skill ${skillName} for task:`;
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(value);
}
