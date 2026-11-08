import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { selectShadcnOption } from "../../test/select-helpers";
import { listIssues } from "../issues/issue-commands";
import {
  createChangeRequest,
  previewChangeRequest,
} from "../project/project-forge-commands";
import { CreateChangeRequestDialog } from "./create-change-request-dialog";

vi.mock("../issues/issue-commands", () => ({
  listIssues: vi.fn(),
}));

vi.mock("../project/project-forge-commands", () => ({
  previewChangeRequest: vi.fn(),
  createChangeRequest: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const listIssuesMock = vi.mocked(listIssues);
const previewMock = vi.mocked(previewChangeRequest);
const createMock = vi.mocked(createChangeRequest);

function renderDialog(): void {
  render(
    <I18nProvider initialLocale="zh">
      <CreateChangeRequestDialog
        host="github"
        open
        projectId={1}
        workspacePath="/tmp/repo"
        onOpenChange={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("CreateChangeRequestDialog", () => {
  beforeEach(() => {
    listIssuesMock.mockReset();
    previewMock.mockReset();
    createMock.mockReset();
    previewMock.mockResolvedValue({
      host: "github",
      currentBranch: "feature",
      repoDefaultBranch: "main",
      branches: ["main", "feature"],
      existingUrl: null,
      title: "Ship",
      body: "Ship the flow",
      completionAction: "open_pull_request",
      prTarget: "issue_base",
      prDraft: false,
    });
    listIssuesMock.mockResolvedValue({
      issues: [
        {
          id: 128,
          number: 7,
          title: "Remote",
          source: "remote",
          externalNumber: 128,
        },
        {
          id: 12,
          number: 12,
          title: "Local",
          source: "local",
          externalNumber: null,
        },
      ] as never,
    });
    createMock.mockResolvedValue({
      url: "https://github.com/acme/redwhisk/pull/128",
    });
  });

  it("选择不关联时不提交 issue", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("combobox", { name: "关联 Issue" });
    await user.click(screen.getByRole("button", { name: "创建 Pull Request" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Ship the flow",
          linkMode: "none",
          linkIssueId: null,
          remoteNumber: null,
        }),
      );
    });
  });

  it("选择远程 Issue 128 时提交远端编号", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("combobox", { name: "关联 Issue" });
    await selectShadcnOption(user, screen, "关联 Issue", "远程 Issue");
    await selectShadcnOption(user, screen, "远程 Issue", "#128 Remote");
    await user.click(screen.getByRole("button", { name: "创建 Pull Request" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Ship the flow",
          linkMode: "remote",
          linkIssueId: 128,
          remoteNumber: 128,
        }),
      );
    });
  });

  it("选择本地 Issue 12 时不把项目编号写成关闭关键字", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("combobox", { name: "关联 Issue" });
    await selectShadcnOption(user, screen, "关联 Issue", "本地 Issue");
    await selectShadcnOption(user, screen, "本地 Issue", "#12 Local");
    await user.click(screen.getByRole("button", { name: "创建 Pull Request" }));
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          linkMode: "local",
          linkIssueId: 12,
          remoteNumber: null,
        }),
      );
    });
    const input = createMock.mock.calls[0]?.[0];
    expect(input?.body).not.toContain("Closes #12");
  });
});
