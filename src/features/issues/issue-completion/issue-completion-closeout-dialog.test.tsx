import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { openShadcnSelect } from "../../../test/select-helpers";
import { IssueCompletionCloseoutDialog } from "./issue-completion-closeout-dialog";

vi.mock("../../project/project-forge-commands", () => ({
  previewChangeRequest: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("IssueCompletionCloseoutDialog", () => {
  it("没有不关联选项", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh">
        <IssueCompletionCloseoutDialog
          state={{
            projectId: 1,
            workspacePath: null,
            workBranch: "feature",
            issueBase: "main",
          }}
          onDecision={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText("不关联")).toBeNull();
    await openShadcnSelect(user, screen, "完成后");
    expect(screen.queryByRole("option", { name: "不关联" })).toBeNull();
  });
});
