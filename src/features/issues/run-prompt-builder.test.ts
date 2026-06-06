import { describe, expect, it } from "vitest";

import { buildRunPromptPreview } from "./run-prompt-builder";

describe("buildRunPromptPreview", () => {
  it("does not inject issue title unless the template explicitly references it", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Fix broken prompt",
        description: "Make the preview reflect the selected profile.",
      },
      profile: {
        mode: "full-auto",
        dangerous: true,
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Focus on {{issue.description}} in {{project.name}}.",
      },
      project: {
        name: "RedWhisk",
        path: "/tmp/redwhisk",
      },
    });

    expect(preview.finalPrompt).toContain(
      "Make the preview reflect the selected profile.",
    );
    expect(preview.finalPrompt).not.toContain("Fix broken prompt");
    expect(preview.defaultArgs).toEqual(["--full-auto", "--dangerous"]);
  });

  it("includes issue title only when the template explicitly references it", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Fix broken prompt",
        description: "Make the preview reflect the selected profile.",
      },
      profile: {
        mode: "full-auto",
        dangerous: false,
        defaultSkill: "",
        promptTemplate: "Issue title: {{issue.title}}",
      },
      project: {
        name: "RedWhisk",
        path: "/tmp/redwhisk",
      },
    });

    expect(preview.finalPrompt).toContain("Issue title: Fix broken prompt");
    expect(preview.defaultArgs).toEqual(["--full-auto"]);
  });

  it("always exposes the expected prompt sources in a stable order", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Fix broken prompt",
        description: "Make the preview reflect the selected profile.",
      },
      profile: {
        mode: "full-auto",
        dangerous: true,
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Template body",
      },
      project: {
        name: "RedWhisk",
        path: "/tmp/redwhisk",
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
