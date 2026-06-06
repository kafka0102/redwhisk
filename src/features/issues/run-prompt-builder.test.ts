import { describe, expect, it } from "vitest";

import { buildRunPromptPreview } from "./run-prompt-builder";

describe("buildRunPromptPreview", () => {
  it("uses the raw issue description as the final prompt preview", () => {
    const preview = buildRunPromptPreview({
      issue: {
        description: "Make the preview reflect the selected profile.",
      },
      profile: {
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Focus on {{issue.description}} in {{project.name}}.",
      },
    });

    expect(preview.finalPrompt).toBe(
      "Make the preview reflect the selected profile.",
    );
  });

  it("always exposes the expected prompt sources in a stable order", () => {
    const preview = buildRunPromptPreview({
      issue: {
        description: "Make the preview reflect the selected profile.",
      },
      profile: {
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Template body",
      },
    });

    expect(preview.sources.map((source) => source.id)).toEqual([
      "issue-description",
      "default-skill",
      "prompt-template",
      "app-instructions",
    ]);
  });
});
