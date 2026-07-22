import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  pullProjectWorktree,
  pushProjectWorktree,
} from "../../shared/workspace/workspace-commands";
import { ChangesBranchMoreMenu } from "./changes-branch-more-menu";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  pullProjectWorktree: vi.fn(),
  pushProjectWorktree: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const pullMock = vi.mocked(pullProjectWorktree);
const pushMock = vi.mocked(pushProjectWorktree);
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

  it("does not show pull or push for worktree root", async () => {
    const user = userEvent.setup();
    renderMenu({ selectedRoot: worktreeRoot });

    await user.click(screen.getByRole("button", { name: "更多" }));
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
      message: "Git 命令执行失败。",
      reason: "gitCommandFailed",
    });
    const onSuccess = vi.fn();
    renderMenu({ onSuccess });

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(await screen.findByText("拉取"));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Git 命令执行失败。",
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
