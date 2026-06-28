import { describe, expect, it } from "vitest";

import { buildRunPromptPreview } from "./run-prompt-builder";

describe("buildRunPromptPreview", () => {
  it("uses the raw issue description as the final prompt preview", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [],
      },
      profile: {
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Focus on {{issue.description}} in {{project.name}}.",
      },
    });

    expect(preview.finalPrompt).toBe(
      [
        "using skill bmad-dev-story for task:",
        "Make the preview reflect the selected profile.",
      ].join("\n\n"),
    );
  });

  it("always exposes the expected prompt sources in a stable order", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [
          {
            id: 1,
            issueId: 1,
            displayName: "tsconfig.json",
            relativePath: ".redwhisk/issues/1/attachments/1-tsconfig.json",
            absolutePath: "/tmp/1-tsconfig.json",
            mimeType: "application/json",
            fileSize: 128,
            kind: "text",
            isPreviewable: true,
            createdAt: 1,
          },
        ],
      },
      profile: {
        defaultSkill: "bmad-dev-story",
        promptTemplate: "Template body",
      },
    });

    expect(preview.sources.map((source) => source.id)).toEqual([
      "issue-description",
      "issue-attachments",
      "default-skill",
      "prompt-template",
      "app-instructions",
    ]);
  });

  it("lists saved attachment paths in the final prompt and sources", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Read config",
        description:
          "Read the config.\n\n{{issue-attachment:12}}\n\n{{issue-attachment:13}}",
        attachments: [
          {
            id: 12,
            issueId: 1,
            displayName: "tsconfig.json",
            relativePath: ".redwhisk/issues/1/attachments/12-tsconfig.json",
            absolutePath: "/tmp/12-tsconfig.json",
            mimeType: "application/json",
            fileSize: 128,
            kind: "text",
            isPreviewable: true,
            createdAt: 1,
          },
          {
            id: 13,
            issueId: 1,
            displayName: "screenshot.png",
            relativePath: ".redwhisk/issues/1/attachments/13-screenshot.png",
            absolutePath: "/tmp/13-screenshot.png",
            mimeType: "image/png",
            fileSize: 256,
            kind: "image",
            isPreviewable: true,
            createdAt: 2,
          },
        ],
      },
      profile: {
        defaultSkill: "",
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toContain("Read the config.");
    expect(preview.finalPrompt).toContain(
      ".redwhisk/issues/1/attachments/12-tsconfig.json",
    );
    expect(preview.finalPrompt).toContain(
      ".redwhisk/issues/1/attachments/13-screenshot.png",
    );
    expect(
      preview.sources.find((source) => source.id === "issue-attachments")
        ?.content,
    ).toContain(".redwhisk/issues/1/attachments/12-tsconfig.json");
  });

  it("strips both bare token lines and image placeholder lines from the description", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "With image",
        description:
          "See screenshot.\n\n![screenshot.png]({{issue-attachment:13}})\n\n{{issue-attachment:12}}",
        attachments: [
          {
            id: 12,
            issueId: 1,
            displayName: "tsconfig.json",
            relativePath: ".redwhisk/issues/1/attachments/12-tsconfig.json",
            absolutePath: "/tmp/12-tsconfig.json",
            mimeType: "application/json",
            fileSize: 128,
            kind: "text",
            isPreviewable: true,
            createdAt: 1,
          },
          {
            id: 13,
            issueId: 1,
            displayName: "screenshot.png",
            relativePath: ".redwhisk/issues/1/attachments/13-screenshot.png",
            absolutePath: "/tmp/13-screenshot.png",
            mimeType: "image/png",
            fileSize: 256,
            kind: "image",
            isPreviewable: true,
            createdAt: 2,
          },
        ],
      },
      profile: {
        defaultSkill: "",
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toContain("See screenshot.");
    // 图片占位符行与裸 token 行都不应出现在最终提示词中。
    expect(preview.finalPrompt).not.toContain("{{issue-attachment:13}}");
    expect(preview.finalPrompt).not.toContain("{{issue-attachment:12}}");
    expect(preview.finalPrompt).not.toContain("![screenshot.png]");
  });

  it("uses a Chinese skill instruction when the issue title or description contains Chinese", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "修复 preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [],
      },
      profile: {
        defaultSkill: "bmad-dev-story",
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toBe(
      [
        "使用skill bmad-dev-story 执行任务：",
        "Make the preview reflect the selected profile.",
      ].join("\n\n"),
    );
  });

  it("builds prompt sections for multiple workflow skills stored as a JSON array", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [],
      },
      profile: {
        defaultSkill: JSON.stringify(["skill-a", "skill-b"]),
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toBe(
      [
        "using skill skill-a for task:",
        "using skill skill-b for task:",
        "Make the preview reflect the selected profile.",
      ].join("\n\n"),
    );
    expect(
      preview.sources.find((source) => source.id === "default-skill")?.content,
    ).toBe("skill-a\nskill-b");
  });
});
