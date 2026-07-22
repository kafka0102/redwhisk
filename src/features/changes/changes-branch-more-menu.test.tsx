import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  deleteCodeWorkspaceWorktree,
  pullProjectWorktree,
  pushProjectWorktree,
} from "../../shared/workspace/workspace-commands";
import { listAgentSessions } from "../agents/agent-session-commands";
import { ChangesBranchMoreMenu } from "./changes-branch-more-menu";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  pullProjectWorktree: vi.fn(),
  pushProjectWorktree: vi.fn(),
  deleteCodeWorkspaceWorktree: vi.fn(),
}));

vi.mock("../agents/agent-session-commands", () => ({
  listAgentSessions: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const pullMock = vi.mocked(pullProjectWorktree);
const pushMock = vi.mocked(pushProjectWorktree);
const deleteMock = vi.mocked(deleteCodeWorkspaceWorktree);
const listSessionsMock = vi.mocked(listAgentSessions);
const toastSuccessMock = vi.mocked(toast.success);

const projectRoot = {
  branch: "main",
  path: "/tmp/repo",
  isProjectRoot: true,
};
const worktreeRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

function renderMenu(
  overrides: {
    selectedRoot?: typeof projectRoot | typeof worktreeRoot | null;
    onSuccess?: () => void;
  } = {},
) {
  return render(
    <I18nProvider initialLocale="zh">
      <ChangesBranchMoreMenu
        projectId={7}
        selectedRoot={
          overrides.selectedRoot === undefined
            ? projectRoot
            : overrides.selectedRoot
        }
        onSuccess={overrides.onSuccess}
      />
    </I18nProvider>,
  );
}

describe("ChangesBranchMoreMenu", () => {
  beforeEach(() => {
    pullMock.mockReset();
    pullMock.mockResolvedValue(undefined);
    pushMock.mockReset();
    pushMock.mockResolvedValue(undefined);
    deleteMock.mockReset();
    deleteMock.mockResolvedValue(undefined);
    listSessionsMock.mockReset();
    listSessionsMock.mockResolvedValue({ sessions: [] });
    toastSuccessMock.mockReset();
  });

  it("shows pull and push for project root without delete", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(await screen.findByText("拉取")).toBeInTheDocument();
    expect(screen.getByText("推送")).toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });

  it("shows only delete for worktree root", async () => {
    const user = userEvent.setup();
    renderMenu({ selectedRoot: worktreeRoot });

    await user.click(screen.getByRole("button", { name: "更多" }));
    expect(await screen.findByText("删除")).toBeInTheDocument();
    expect(screen.queryByText("拉取")).not.toBeInTheDocument();
    expect(screen.queryByText("推送")).not.toBeInTheDocument();
  });

  it("pulls selected root path, shows loading then success toast and refreshes", async () => {
    const user = userEvent.setup();
    let resolvePull: (() => void) | undefined;
    pullMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = resolve;
        }),
    );
    const onSuccess = vi.fn();
    renderMenu({ onSuccess });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("拉取"));

    expect(await screen.findByText("正在拉取…")).toBeInTheDocument();
    expect(pullMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: "/tmp/repo",
    });

    resolvePull?.();
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("拉取成功");
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("正在拉取…")).not.toBeInTheDocument();
    });
  });

  it("pushes selected root path and refreshes on success", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderMenu({ onSuccess });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("推送"));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("推送成功");
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows error alert dialog when pull fails", async () => {
    const user = userEvent.setup();
    pullMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "Git command failed: refused",
      reason: "gitCommandFailed",
      details: [
        {
          "@type": "Cause",
          message: "error: failed to push some refs to origin",
        },
      ],
    });
    const onSuccess = vi.fn();
    renderMenu({ onSuccess });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("拉取"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Git 命令执行失败。");
    expect(dialog).toHaveTextContent(
      "error: failed to push some refs to origin",
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
  it("blocks delete with alert when worktree has running turn", async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          sessionId: 11,
          number: 1,
          projectId: 7,
          issueId: 3,
          issueNumber: 3,
          issueTitle: "t",
          issueStatus: "running",
          agentProfileId: 1,
          agentProfileName: "p",
          workflowSkillName: null,
          canCompleteClean: false,
          canCompleteAgentCommit: false,
          title: null,
          agentType: "codex",
          displayMode: "json",
          status: "running",
          attention: "none",
          isTurnRunning: true,
          workspaceMode: "worktree",
          workingDir: worktreeRoot.path,
          workspacePath: worktreeRoot.path,
          originBranch: null,
          workspaceBranch: worktreeRoot.branch,
          worktreeOwner: "redwhisk",
          logPath: "/tmp/s.log",
          latestOutput: null,
          lastActiveAt: 1,
          startedAt: 1,
          closedAt: null,
          processingMs: 0,
          lastOutputAt: null,
        },
      ],
    });
    renderMenu({ selectedRoot: worktreeRoot });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("删除"));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "该工作区仍有进行中的智能体任务，无法删除。",
    );
    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.queryByText("确定要删除吗？")).not.toBeInTheDocument();
  });

  it("confirms then deletes worktree with command params and success toast", async () => {
    const user = userEvent.setup();
    let resolveDelete: (() => void) | undefined;
    deleteMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    renderMenu({ selectedRoot: worktreeRoot });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("删除"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确定要删除吗？");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    expect(await screen.findByText("正在删除…")).toBeInTheDocument();
    expect(listSessionsMock).toHaveBeenCalledWith(7, { status: "running" });
    expect(deleteMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: worktreeRoot.path,
    });

    resolveDelete?.();
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("删除成功");
    });
    await waitFor(() => {
      expect(screen.queryByText("正在删除…")).not.toBeInTheDocument();
    });
  });
});
