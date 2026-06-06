import type { AgentProfileRecord } from "../settings/settings-commands";
import type { IssueRecord } from "./issue-commands";

export interface RunPromptSource {
  id:
    | "issue-description"
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
  issue: Pick<IssueRecord, "description">;
  profile: Pick<AgentProfileRecord, "defaultSkill" | "promptTemplate">;
}

const APP_INSTRUCTIONS =
  "你正在 RedWhisk 中处理一个本地 issue。优先依据给定 issue 描述完成任务；如果上下文不足，先明确缺口再继续行动。";

export function buildRunPromptPreview(
  input: BuildRunPromptPreviewInput,
): RunPromptPreview {
  const issueDescription = input.issue.description.trim();
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

  return {
    finalPrompt: issueDescription,
    sources,
  };
}
