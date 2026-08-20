import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(root);
  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("code language intelligence boundaries", () => {
  it("does not import typescript packages into the frontend app", () => {
    const srcRoot = join(process.cwd(), "src");
    const forbidden = [
      /from ["']typescript["']/,
      /from ["']typescript-language-server["']/,
    ];
    const violations: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      if (file.includes("/shared/commands/__parity__/")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (forbidden.some((pattern) => pattern.test(source))) {
        violations.push(relative(srcRoot, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not start the language host from session viewer or diff surfaces", () => {
    const files = [
      "src/features/agents/session-workspace/session-file-viewer.tsx",
      "src/shared/workspace/diff-viewer.tsx",
      "src/shared/workspace/multi-diff-viewer.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/ensureCodeLanguageHost/);
      expect(source).not.toMatch(/use-code-language-host/);
      expect(source).not.toMatch(/code-language-commands/);
    }
  });
});
