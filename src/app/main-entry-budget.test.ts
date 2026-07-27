import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("main entry startup budget", () => {
  it("does not eagerly import monaco-editor on the app entry path", () => {
    const mainSource = readFileSync(
      resolve(process.cwd(), "src/main.tsx"),
      "utf8",
    );
    expect(mainSource).not.toMatch(/monaco-editor-setup/);
    expect(mainSource).not.toMatch(/monaco-editor/);
    expect(mainSource).not.toMatch(/configureMonacoEditor/);
  });

  it("keeps non-default activities behind dynamic import() in the activity router", () => {
    const routerSource = readFileSync(
      resolve(process.cwd(), "src/app/activity-router.tsx"),
      "utf8",
    );
    expect(routerSource).toMatch(/lazy\(/);
    expect(routerSource).toMatch(
      /import\("\.\.\/features\/code\/code-activity"\)/,
    );
    expect(routerSource).toMatch(
      /import\("\.\.\/features\/terminals\/project-terminals-activity"\)/,
    );
    expect(routerSource).toMatch(
      /import\("\.\.\/features\/agents\/agents-activity"\)/,
    );
    // Issues 是默认首页，保持同步 import 以便首屏立即可用。
    expect(routerSource).toMatch(
      /import \{ IssuesActivity \} from "\.\.\/features\/issues\/issues-activity"/,
    );
  });

  it("keeps issue detail pages behind dynamic import() on the issues activity path", () => {
    const activitySource = readFileSync(
      resolve(process.cwd(), "src/features/issues/issues-activity.tsx"),
      "utf8",
    );
    expect(activitySource).toMatch(/lazy\(/);
    expect(activitySource).toMatch(
      /import\("\.\/issue-detail\/issue-editable-page"\)/,
    );
    expect(activitySource).toMatch(
      /import\("\.\/issue-detail\/issue-read-only-page"\)/,
    );
    // 看板首屏不得同步拉起 Quill / react-markdown 所在详情页。
    expect(activitySource).not.toMatch(
      /import \{ IssueEditablePage \} from "\.\/issue-detail\/issue-editable-page"/,
    );
    expect(activitySource).not.toMatch(
      /import \{ IssueReadOnlyPage \} from "\.\/issue-detail\/issue-read-only-page"/,
    );
  });
});
