import { describe, expect, it } from "vitest";

import {
  buildRunPromptPreview,
  ISSUE_DELIVERY_SUMMARY_INSTRUCTION,
} from "./run-prompt-builder";

describe("buildRunPromptPreview", () => {
  it("uses the raw issue description as the final prompt preview", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [],
      },
      profile: {
        promptTemplate: "Focus on {{issue.description}} in {{project.name}}.",
      },
      selectedWorkflowSkill: "bmad-dev-story",
    });

    expect(preview.finalPrompt).toContain(
      "using skill bmad-dev-story for task:",
    );
    expect(preview.finalPrompt).toContain(
      "Make the preview reflect the selected profile.",
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
            storedName: "1-tsconfig.json",
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
        promptTemplate: "Template body",
      },
      selectedWorkflowSkill: "bmad-dev-story",
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
            storedName: "12-tsconfig.json",
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
            storedName: "13-screenshot.png",
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
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toContain("Read the config.");
    expect(preview.finalPrompt).toContain("/tmp/12-tsconfig.json");
    expect(preview.finalPrompt).toContain("/tmp/13-screenshot.png");
    expect(
      preview.sources.find((source) => source.id === "issue-attachments")
        ?.content,
    ).toContain("/tmp/12-tsconfig.json");
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
            storedName: "12-tsconfig.json",
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
            storedName: "13-screenshot.png",
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
        promptTemplate: "",
      },
      selectedWorkflowSkill: "bmad-dev-story",
    });

    expect(preview.finalPrompt).toContain(
      "使用skill bmad-dev-story 执行任务：",
    );
    expect(preview.finalPrompt).toContain(
      "Make the preview reflect the selected profile.",
    );
  });

  it("builds a prompt section for the selected workflow skill", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Make the preview reflect the selected profile.",
        attachments: [],
      },
      profile: {
        promptTemplate: "",
      },
      selectedWorkflowSkill: "skill-a",
    });

    expect(preview.finalPrompt).toContain("using skill skill-a for task:");
    expect(preview.finalPrompt).toContain(
      "Make the preview reflect the selected profile.",
    );
    expect(
      preview.sources.find((source) => source.id === "default-skill")?.content,
    ).toBe("skill-a");
  });

  it("appends isomorphic issue delivery summary instruction to finalPrompt and sources", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Prompt preview",
        description: "Ship the feature.",
        attachments: [],
      },
      profile: {
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toContain(ISSUE_DELIVERY_SUMMARY_INSTRUCTION);
    expect(
      preview.finalPrompt.endsWith(ISSUE_DELIVERY_SUMMARY_INSTRUCTION),
    ).toBe(true);
    expect(preview.finalPrompt).toContain("Ship the feature.");
    expect(
      preview.sources.find((source) => source.id === "app-instructions")
        ?.content,
    ).toContain(ISSUE_DELIVERY_SUMMARY_INSTRUCTION);
  });

  it("still injects delivery summary instruction when issue description is empty", () => {
    const preview = buildRunPromptPreview({
      issue: {
        title: "Empty body",
        description: "   ",
        attachments: [],
      },
      profile: {
        promptTemplate: "",
      },
    });

    expect(preview.finalPrompt).toContain("<issue-comment>");
    expect(preview.finalPrompt).toContain("精简中文交付摘要");
    expect(preview.finalPrompt).toContain("系统优先提取为 Issue 评论");
  });
});
