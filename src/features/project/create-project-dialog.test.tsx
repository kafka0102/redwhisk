import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { selectShadcnOption } from "../../test/select-helpers";
import {
  CreateProjectDialog,
  type CreateProjectDialogDraft,
} from "./create-project-dialog";
import { validateProjectRepoPath } from "./project-commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("./project-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./project-commands")>();
  return {
    ...actual,
    validateProjectRepoPath: vi.fn(),
  };
});

const openDialogMock = vi.mocked(open);
const validateProjectRepoPathMock = vi.mocked(validateProjectRepoPath);

function draft(
  overrides: Partial<CreateProjectDialogDraft> = {},
): CreateProjectDialogDraft {
  return {
    name: "app",
    repoPath: "",
    suggestedName: "app",
    worktreeLocation: "repo_sibling",
    worktreeSetupCommand: "",
    host: "none",
    completionAction: "merge_to_base",
    confirmCompletionAction: false,
    ...overrides,
  };
}

function renderDialog(
  initialDraft: CreateProjectDialogDraft,
  onCreate: (input: unknown) => Promise<void> = vi.fn(async () => undefined),
) {
  render(
    <I18nProvider initialLocale="zh">
      <CreateProjectDialog
        initialDraft={initialDraft}
        onClose={vi.fn()}
        onCreate={onCreate}
      />
    </I18nProvider>,
  );
  return onCreate;
}

describe("CreateProjectDialog", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    validateProjectRepoPathMock.mockReset();
  });

  it("hides completion choices before a path is chosen", () => {
    renderDialog(draft());

    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    expect(
      screen.queryByText("完成后是否确认合并方式"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("创建为草稿")).not.toBeInTheDocument();
  });

  it("shows Pull Request wording and submits issue base without a draft", async () => {
    const onCreate = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/app",
        suggestedName: "app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
      onCreate,
    );

    expect(screen.getByRole("combobox", { name: "完成后" })).toHaveTextContent(
      "提交 Pull Request",
    );
    expect(
      screen.getByRole("combobox", { name: "完成后是否确认合并方式" }),
    ).toHaveTextContent("是");
    expect(screen.queryByText("提交 Merge Request")).not.toBeInTheDocument();
    expect(screen.queryByText("创建为草稿")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull Request 目标")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "app",
      repoPath: "/tmp/app",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      completionAction: "open_pull_request",
      confirmCompletionAction: true,
      prTarget: "issue_base",
      prDraft: false,
    });
  });

  it("shows Merge Request wording for GitLab", () => {
    renderDialog(
      draft({
        repoPath: "/tmp/gitlab-app",
        host: "gitlab",
        completionAction: "open_pull_request",
        confirmCompletionAction: false,
      }),
    );

    expect(screen.getByRole("combobox", { name: "完成后" })).toHaveTextContent(
      "提交 Merge Request",
    );
    expect(screen.queryByText("提交 Pull Request")).not.toBeInTheDocument();
  });

  it("refills both choices when the source changes before the user edits them", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/gitlab-app");
    validateProjectRepoPathMock.mockResolvedValue({
      repoPath: "/tmp/gitlab-app",
      suggestedName: "gitlab-app",
      host: "gitlab",
      completionAction: "merge_to_base",
      confirmCompletionAction: false,
    });
    renderDialog(
      draft({
        repoPath: "/tmp/github-app",
        suggestedName: "github-app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
    );

    await user.click(screen.getByRole("button", { name: "选择目录" }));

    expect(screen.getByRole("combobox", { name: "完成后" })).toHaveTextContent(
      "合并到 base 分支",
    );
    expect(
      screen.getByRole("combobox", { name: "完成后是否确认合并方式" }),
    ).toHaveTextContent("否");
  });

  it("keeps hand edits across GitHub and GitLab even after changing back to the suggested value", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/gitlab-app");
    validateProjectRepoPathMock.mockResolvedValue({
      repoPath: "/tmp/gitlab-app",
      suggestedName: "gitlab-app",
      host: "gitlab",
      completionAction: "merge_to_base",
      confirmCompletionAction: false,
    });
    renderDialog(
      draft({
        repoPath: "/tmp/github-app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
    );

    await selectShadcnOption(user, screen, "完成后是否确认合并方式", "否");
    await selectShadcnOption(user, screen, "完成后是否确认合并方式", "是");
    await user.click(screen.getByRole("button", { name: "选择目录" }));

    expect(screen.getByRole("combobox", { name: "完成后" })).toHaveTextContent(
      "提交 Merge Request",
    );
    expect(
      screen.getByRole("combobox", { name: "完成后是否确认合并方式" }),
    ).toHaveTextContent("是");
    expect(screen.queryByText("合并到 base 分支")).not.toBeInTheDocument();
  });

  it("hides completion choices and submits the other-source defaults after the path is cleared or unrecognized", async () => {
    const onCreate = vi.fn(async () => undefined);
    const user = userEvent.setup();
    openDialogMock
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("/tmp/other-app");
    validateProjectRepoPathMock.mockResolvedValue({
      repoPath: "/tmp/other-app",
      suggestedName: "other-app",
      host: "none",
      completionAction: "open_pull_request",
      confirmCompletionAction: true,
    });
    renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/github-app",
        suggestedName: "app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
      onCreate,
    );

    await selectShadcnOption(user, screen, "完成后", "合并到 base 分支");
    await user.click(screen.getByRole("button", { name: "选择目录" }));

    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    expect(
      screen.queryByText("完成后是否确认合并方式"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(screen.getByLabelText("仓库路径")).toHaveValue("/tmp/other-app");
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "other-app",
      repoPath: "/tmp/other-app",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      completionAction: "merge_to_base",
      confirmCompletionAction: false,
      prTarget: "issue_base",
      prDraft: false,
    });
  });
});
