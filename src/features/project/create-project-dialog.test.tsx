import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { selectShadcnOption } from "../../test/select-helpers";
import {
  CreateProjectDialog,
  type CreateProjectDialogDraft,
} from "./create-project-dialog";
import {
  validateProjectRepoPath,
  type CreateProjectInput,
  type ValidatedExistingProject,
} from "./project-commands";

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

function savedProject(
  overrides: Partial<ValidatedExistingProject> = {},
): ValidatedExistingProject {
  return {
    id: 7,
    removed: false,
    name: "Saved",
    worktreeLocation: "user_home",
    worktreeSetupCommand: "echo hi",
    issueSourceMode: "remote",
    issueSyncScope: "label",
    issueSyncLabel: "bug",
    issueSyncEnabled: true,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: true,
    issueWritebackCloseOnPrMerge: false,
    issueWritebackComment: true,
    completionAction: "open_pull_request",
    prTarget: "repo_default",
    prDraft: true,
    confirmCompletionAction: true,
    ...overrides,
  };
}

function createdPayload(
  overrides: Partial<CreateProjectInput> = {},
): CreateProjectInput {
  return {
    name: "app",
    repoPath: "/tmp/app",
    worktreeLocation: "repo_sibling",
    worktreeSetupCommand: "",
    completionAction: "merge_to_base",
    confirmCompletionAction: false,
    prTarget: "issue_base",
    prDraft: false,
    issueSourceMode: "local",
    issueSyncScope: "assigned_to_me",
    issueSyncEnabled: true,
    issueSyncIntervalSeconds: 90,
    issueWritebackCloseOnComplete: true,
    issueWritebackCloseOnPrMerge: true,
    issueWritebackComment: true,
    ...overrides,
  };
}

function renderDialog(
  initialDraft: CreateProjectDialogDraft,
  onCreate: (input: CreateProjectInput) => Promise<void> = vi.fn(
    async () => undefined,
  ),
  onClose: () => void = vi.fn(),
) {
  render(
    <I18nProvider initialLocale="zh">
      <CreateProjectDialog
        initialDraft={initialDraft}
        onClose={onClose}
        onCreate={onCreate}
      />
    </I18nProvider>,
  );
  return { onCreate, onClose };
}

async function goNext(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "下一步" }));
}

describe("CreateProjectDialog", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    validateProjectRepoPathMock.mockReset();
  });

  it("第一步主按钮是下一步且不渲染来源模式远程连接和完成后", () => {
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));

    expect(screen.getByLabelText("项目名称")).toHaveValue("app");
    expect(screen.getByLabelText("仓库路径")).toHaveValue("/tmp/app");
    expect(screen.getByLabelText("工作树路径")).toBeInTheDocument();
    expect(
      screen.getByLabelText("创建工作树后的初始化命令"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "创建项目" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("来源模式")).not.toBeInTheDocument();
    expect(screen.queryByText("远程连接")).not.toBeInTheDocument();
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
  });

  it("名称为空或仓库路径为空时下一步不可用", () => {
    renderDialog(draft({ name: "  ", repoPath: "/tmp/app" }));
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    cleanup();
    renderDialog(draft({ name: "app", repoPath: "" }));
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    cleanup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app" }));
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
  });

  it("宿主还是空串时第二步不渲染来源模式远程连接和完成后", async () => {
    const user = userEvent.setup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "" }));
    await goNext(user);
    expect(screen.queryByText("来源模式")).not.toBeInTheDocument();
    expect(screen.queryByText("远程连接")).not.toBeInTheDocument();
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
  });

  it("仅本地不渲染远程连接但渲染完成后", async () => {
    const user = userEvent.setup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));
    await goNext(user);
    expect(screen.getByText("来源模式")).toBeInTheDocument();
    expect(screen.queryByText("远程连接")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toBeInTheDocument();
  });

  it("宿主 none 且混合模式有远程连接没有完成后", async () => {
    const user = userEvent.setup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "none" }));
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "混合" }));
    expect(screen.getByText("远程连接")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "完成后动作" }),
    ).not.toBeInTheDocument();
  });

  it("混合模式第二步把来源内容放进滚动区，底部按钮留在滚动区外", async () => {
    const user = userEvent.setup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "混合" }));

    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    const scroller = dialog.querySelector(
      ".create-project-issues-step__content",
    );
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(screen.getByText("来源模式"));
    expect(scroller).toContainElement(screen.getByText("远程连接"));
    expect(scroller).toContainElement(screen.getByText("完成后"));
    for (const name of ["上一步", "取消", "创建项目"]) {
      const button = screen.getByRole("button", { name });
      expect(dialog).toContainElement(button);
      expect(scroller).not.toContainElement(button);
    }
  });

  it("连接探测未返回时远程连接显示尚未检查且重新登录可用", async () => {
    const user = userEvent.setup();
    validateProjectRepoPathMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    expect(screen.getByLabelText("账号")).toHaveValue("");
    expect(screen.getByText("尚未检查")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新登录" })).toBeEnabled();
  });

  it("宿主仓库和账号不能改成另一个值", async () => {
    const user = userEvent.setup();
    validateProjectRepoPathMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    const host = screen.getByRole("combobox", { name: "宿主" });
    expect(host).toHaveTextContent("GitHub");
    await selectShadcnOption(user, screen, "宿主", "GitLab");
    expect(host).toHaveTextContent("GitHub");
    expect(screen.getByLabelText("仓库")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("账号")).toHaveAttribute("readonly");
  });

  it("全新项目默认仅本地并沿用路径建议的完成后动作", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
    );
    await goNext(user);
    expect(screen.getByRole("radio", { name: "仅本地" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("提交 Pull Request");
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    expect(
      screen.getByRole("combobox", { name: "拉取范围" }),
    ).toHaveTextContent("分配给我");
    expect(
      screen.getByRole("checkbox", { name: "页面可见时自动同步" }),
    ).toBeChecked();
    expect(screen.getByRole("combobox", { name: "间隔" })).toHaveTextContent(
      "90 秒",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "本地完成且合并到 base 时，关闭远程 Issue",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "PR 合并后关闭关联的远程 Issue" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "完成后把交付摘要评论回写远程" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "创建为草稿" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledWith(
      createdPayload({
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
        issueSourceMode: "remote",
      }),
    );
  });

  it("合并到 base 不渲染请求目标和草稿，提交请求才渲染", async () => {
    const user = userEvent.setup();
    renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/app",
        host: "github",
        completionAction: "merge_to_base",
        repoDefaultBranch: "main",
      }),
    );
    await goNext(user);
    expect(screen.queryByText("创建为草稿")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "PR 目标" }),
    ).not.toBeInTheDocument();
    await selectShadcnOption(user, screen, "完成后动作", "提交 Pull Request");
    expect(screen.getByText("创建为草稿")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "PR 目标" })).toHaveTextContent(
      "main",
    );
    cleanup();
    renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/gitlab",
        host: "gitlab",
        completionAction: "open_pull_request",
      }),
    );
    await goNext(user);
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("提交 Merge Request");
    expect(screen.getByRole("combobox", { name: "MR 目标" })).toHaveTextContent(
      "Issue 的 base 分支",
    );
    expect(
      screen.getByRole("combobox", { name: "MR 目标" }),
    ).not.toHaveTextContent("(");
  });

  it("指定标签为空时不能创建，去掉空白后的标签会提交", async () => {
    const user = userEvent.setup();
    validateProjectRepoPathMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    const { onCreate } = renderDialog(
      draft({ name: "app", repoPath: "/tmp/app", host: "github" }),
    );
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    await selectShadcnOption(user, screen, "拉取范围", "指定标签");
    await user.type(screen.getByLabelText("标签"), "   ");
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
    await user.clear(screen.getByLabelText("标签"));
    await user.type(screen.getByLabelText("标签"), "  bug  ");
    expect(screen.getByRole("button", { name: "创建项目" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledWith(
      createdPayload({
        issueSourceMode: "remote",
        issueSyncScope: "label",
        issueSyncLabel: "bug",
      }),
    );
  });

  it("创建弹窗切换来源模式不出现确认框", async () => {
    const user = userEvent.setup();
    renderDialog(draft({ name: "app", repoPath: "/tmp/app", host: "github" }));
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    expect(
      screen.queryByRole("button", { name: "切换模式" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("远程连接")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "仅远程" }).closest("label"),
    ).toHaveAttribute("data-selected", "true");
  });

  it("上一步保留第一步的值，取消不创建", async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/app",
        worktreeLocation: "user_home",
        worktreeSetupCommand: "pnpm i",
        host: "github",
      }),
    );
    await user.clear(screen.getByLabelText("项目名称"));
    await user.type(screen.getByLabelText("项目名称"), "renamed");
    await goNext(user);
    await user.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText("项目名称")).toHaveValue("renamed");
    expect(screen.getByLabelText("仓库路径")).toHaveValue("/tmp/app");
    expect(screen.getByLabelText("创建工作树后的初始化命令")).toHaveValue(
      "pnpm i",
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("第一步按 Enter 进入第二步，第二步按 Enter 才提交", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog(
      draft({ name: "app", repoPath: "/tmp/app", host: "github" }),
    );
    await user.click(screen.getByLabelText("项目名称"));
    await user.keyboard("{Enter}");
    expect(screen.getByText("来源模式")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "仅本地" }));
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("弹窗有 aria-modal，英文界面使用 Next", () => {
    renderDialog(draft({ name: "app", repoPath: "/tmp/app" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    cleanup();
    render(
      <I18nProvider initialLocale="en">
        <CreateProjectDialog
          initialDraft={draft({ name: "app", repoPath: "/tmp/app" })}
          onClose={vi.fn()}
          onCreate={vi.fn(async () => undefined)}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下一步" }),
    ).not.toBeInTheDocument();
  });

  it("不是 Git 仓库时留下路径错误并且不创建", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/plain");
    validateProjectRepoPathMock.mockRejectedValue({
      code: "PROJECT_REPO_NOT_GIT_REPOSITORY",
      message: "所选目录不是 Git Repository。",
    });
    const { onCreate } = renderDialog(draft({ name: "app", repoPath: "" }));
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "所选目录不是 Git Repository。",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("仍在列表中的项目展示已保存值且控件不可编辑", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog(
      draft({
        name: "typed",
        repoPath: "/tmp/app",
        host: "github",
        existingProject: savedProject(),
      }),
    );
    expect(screen.getByLabelText("项目名称")).toHaveValue("Saved");
    expect(screen.getByLabelText("项目名称")).toBeDisabled();
    expect(screen.getByLabelText("创建工作树后的初始化命令")).toHaveValue(
      "echo hi",
    );
    expect(screen.getByLabelText("创建工作树后的初始化命令")).toBeDisabled();
    await goNext(user);
    expect(screen.getByRole("radio", { name: "仅远程" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "仅远程" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledWith(
      createdPayload({
        name: "Saved",
        worktreeLocation: "user_home",
        worktreeSetupCommand: "echo hi",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
        prTarget: "repo_default",
        prDraft: true,
        issueSourceMode: "remote",
        issueSyncScope: "label",
        issueSyncLabel: "bug",
        issueWritebackCloseOnPrMerge: false,
      }),
    );
  });

  it("已移除项目的第二步初始值来自已保存设置", async () => {
    const user = userEvent.setup();
    validateProjectRepoPathMock.mockImplementation(
      () => new Promise(() => undefined),
    );
    const { onCreate } = renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/app",
        host: "github",
        existingProject: savedProject({
          removed: true,
          name: "Old",
          issueSourceMode: "mixed",
          issueSyncScope: "all_open",
          issueSyncLabel: null,
          issueSyncEnabled: false,
          issueSyncIntervalSeconds: 300,
          issueWritebackCloseOnComplete: false,
          issueWritebackCloseOnPrMerge: true,
          issueWritebackComment: false,
          completionAction: "merge_to_base",
          prTarget: "issue_base",
          prDraft: false,
          confirmCompletionAction: false,
        }),
      }),
    );
    expect(screen.getByLabelText("项目名称")).toHaveValue("app");
    expect(screen.getByLabelText("项目名称")).toBeEnabled();
    await goNext(user);
    expect(screen.getByRole("radio", { name: "混合" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "拉取范围" }),
    ).toHaveTextContent("全部未关闭");
    expect(
      screen.getByRole("checkbox", { name: "页面可见时自动同步" }),
    ).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "间隔" })).toHaveTextContent(
      "5 分钟",
    );
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("合并到 base 分支");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledWith(
      createdPayload({
        issueSourceMode: "mixed",
        issueSyncScope: "all_open",
        issueSyncEnabled: false,
        issueSyncIntervalSeconds: 300,
        issueWritebackCloseOnComplete: false,
        issueWritebackCloseOnPrMerge: true,
        issueWritebackComment: false,
      }),
    );
  });

  it("重新登录只探测连接，取消后不创建", async () => {
    const user = userEvent.setup();
    validateProjectRepoPathMock.mockResolvedValue({
      repoPath: "/tmp/app",
      suggestedName: "app",
      host: "github",
      completionAction: "merge_to_base",
      confirmCompletionAction: false,
      connection: {
        provider: "github",
        hostUrl: "https://github.com",
        repoPath: "acme/app",
        login: "yujianjia",
        cliInstalled: true,
        cliAuthenticated: true,
        authStatus: "ready",
        checkedAt: 1,
      },
    });
    const { onCreate, onClose } = renderDialog(
      draft({ name: "app", repoPath: "/tmp/app", host: "github" }),
    );
    await goNext(user);
    await user.click(screen.getByRole("radio", { name: "仅远程" }));
    await user.click(screen.getByRole("button", { name: "重新登录" }));
    await waitFor(() => {
      expect(validateProjectRepoPathMock).toHaveBeenCalledWith({
        repoPath: "/tmp/app",
        probeConnection: true,
      });
    });
    expect(await screen.findByText("已登录")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("改路径前没有手改时，第二步改用新的完成后建议", async () => {
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
    await goNext(user);
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("合并到 base 分支");
    expect(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    ).not.toBeChecked();
  });

  it("手改完成后选择后，换到 GitLab 仍保留手改", async () => {
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
    await goNext(user);
    await user.click(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    );
    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    await goNext(user);
    expect(
      screen.getByRole("combobox", { name: "完成后动作" }),
    ).toHaveTextContent("提交 Merge Request");
    expect(
      screen.getByRole("checkbox", { name: "完成时再次确认动作" }),
    ).toBeChecked();
    expect(screen.queryByText("合并到 base 分支")).not.toBeInTheDocument();
  });

  it("清空或未识别宿主后提交合并到 base 的默认值", async () => {
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
    const { onCreate } = renderDialog(
      draft({
        name: "app",
        repoPath: "/tmp/github-app",
        suggestedName: "app",
        host: "github",
        completionAction: "open_pull_request",
        confirmCompletionAction: true,
      }),
    );
    await goNext(user);
    await selectShadcnOption(user, screen, "完成后动作", "合并到 base 分支");
    await user.click(screen.getByRole("button", { name: "上一步" }));
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(screen.queryByText("完成后")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(screen.getByLabelText("仓库路径")).toHaveValue("/tmp/other-app");
    await goNext(user);
    expect(
      screen.queryByRole("combobox", { name: "完成后动作" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledWith(
      createdPayload({
        name: "other-app",
        repoPath: "/tmp/other-app",
      }),
    );
  });
});
