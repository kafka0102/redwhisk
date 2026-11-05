import { describe, expect, it } from "vitest";

import type { CodeFileTab } from "./code-workspace-cache";
import { rebaseCodeFileTabs, rebasePathSet } from "./code-file-tab-rebase";

function tab(filePath: string, isDirty: boolean): CodeFileTab {
  const separator = filePath.lastIndexOf("/");
  return {
    content: null,
    errorMessage: null,
    fileName: separator === -1 ? filePath : filePath.slice(separator + 1),
    filePath,
    isDirty,
    isEditable: true,
    isLoading: false,
    lastActiveAt: 1,
    savedContent: "saved",
  };
}

describe("rebaseCodeFileTabs", () => {
  it("rebases a dirty open tab onto the moved path without clearing unsaved content", () => {
    const [moved, untouched] = rebaseCodeFileTabs(
      [tab("src/app.tsx", true), tab("README.md", false)],
      "src/app.tsx",
      "components/app.tsx",
    );

    expect(moved).toMatchObject({
      fileName: "app.tsx",
      filePath: "components/app.tsx",
      isDirty: true,
      savedContent: "saved",
    });
    expect(untouched.filePath).toBe("README.md");
  });

  it("rebases descendant tabs when a directory is renamed", () => {
    const [moved] = rebaseCodeFileTabs(
      [tab("src/app.tsx", true)],
      "src",
      "lib",
    );

    expect(moved).toMatchObject({
      fileName: "app.tsx",
      filePath: "lib/app.tsx",
      isDirty: true,
    });
    expect(
      rebasePathSet(new Set(["src", "src/components", "other"]), "src", "lib"),
    ).toEqual(new Set(["lib", "lib/components", "other"]));
  });
});
