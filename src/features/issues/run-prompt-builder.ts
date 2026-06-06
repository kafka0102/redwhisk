import type { AgentProfileRecord } from "../settings/settings-commands";
import type { IssueRecord } from "./issue-commands";

export interface RunPromptProjectContext {
  name: string;
  path: string;
}

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
  defaultArgs: string[];
  finalPrompt: string;
  sources: RunPromptSource[];
}

interface BuildRunPromptPreviewInput {
  issue: Pick<IssueRecord, "title" | "description">;
  profile: Pick<
    AgentProfileRecord,
    "mode" | "dangerous" | "defaultSkill" | "promptTemplate"
  >;
  project: RunPromptProjectContext;
}

const APP_INSTRUCTIONS =
  "你正在 RedWhisk 中处理一个本地 issue。优先依据给定 issue 描述完成任务；如果上下文不足，先明确缺口再继续行动。";

export function buildRunPromptPreview(
  input: BuildRunPromptPreviewInput,
): RunPromptPreview {
  const issueDescription = input.issue.description.trim();
  const defaultSkill = input.profile.defaultSkill.trim();
  const promptTemplate = input.profile.promptTemplate.trim();
  const defaultArgs = buildDefaultArgsPreview(input.profile);
  const sources: RunPromptSource[] = [];
  const sections: string[] = [];

  if (issueDescription.length > 0) {
    sources.push({
      id: "issue-description",
      label: "Issue description",
      content: issueDescription,
    });
    sections.push(`Issue description:\n${issueDescription}`);
  }

  if (defaultSkill.length > 0) {
    sources.push({
      id: "default-skill",
      label: "Default skill",
      content: defaultSkill,
    });
    sections.push(`Default skill:\n${defaultSkill}`);
  }

  if (promptTemplate.length > 0) {
    const renderedTemplate = renderPromptTemplate(promptTemplate, input);
    sources.push({
      id: "prompt-template",
      label: "Prompt template",
      content: promptTemplate,
    });

    if (renderedTemplate.length > 0) {
      sections.push(`Prompt template:\n${renderedTemplate}`);
    }
  }

  sources.push({
    id: "app-instructions",
    label: "App instructions",
    content: APP_INSTRUCTIONS,
  });
  sections.push(
    `Project context:\n- Project: ${input.project.name}\n- Working directory: ${input.project.path}`,
  );
  sections.push(`App instructions:\n${APP_INSTRUCTIONS}`);

  return {
    defaultArgs,
    finalPrompt: sections.join("\n\n").trim(),
    sources,
  };
}

function buildDefaultArgsPreview(
  profile: Pick<AgentProfileRecord, "mode" | "dangerous">,
): string[] {
  const args = [`--${profile.mode}`];
  if (profile.dangerous) {
    args.push("--dangerous");
  }
  return args;
}

function renderPromptTemplate(
  template: string,
  input: BuildRunPromptPreviewInput,
): string {
  const replacements: Record<string, string> = {
    "{{issue.title}}": input.issue.title.trim(),
    "{{issue.description}}": input.issue.description.trim(),
    "{{project.name}}": input.project.name.trim(),
    "{{project.path}}": input.project.path.trim(),
    "{{agent.defaultSkill}}": input.profile.defaultSkill.trim(),
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }

  return rendered.trim();
}
