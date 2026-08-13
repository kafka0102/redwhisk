import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  fetchProjectRemotes,
  listProjectMergeBranches,
  mergeProjectBranch,
} from "../../shared/workspace/workspace-commands";
import { MergeBranchDialog } from "./merge-branch-dialog";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  listProjectMergeBranches: vi.fn(),
  fetchProjectRemotes: vi.fn(),
  mergeProjectBranch: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const listMock = vi.mocked(listProjectMergeBranches);
const fetchMock = vi.mocked(fetchProjectRemotes);
const mergeMock = vi.mocked(mergeProjectBranch);
const toastSuccessMock = vi.mocked(toast.success);

const sampleResponse = {
  currentBranch: "main",
  hasUncommittedChanges: false,
  localBranches: [
    {
      name: "feature-new",
      authorName: "Alice",
      shortHash: "abc1234",
      message: "newest",
      committedAt: Date.now() - 60_000,
    },
    {
      name: "feature-occupied",
      authorName: "Dana",
      shortHash: "occ1111",
      message: "occupied",
      committedAt: Date.now() - 120_000,
    },
    {
      name: "main",
      authorName: "Bob",
      shortHash: "def5678",
      message: "base",
      committedAt: Date.now() - 3_600_000,
    },
  ],
  remoteBranches: [
    {
      name: "origin/feature-remote",
      authorName: "Carol",
      shortHash: "ghi9012",
      message: "remote tip",
      committedAt: Date.now() - 7_200_000,
    },
  ],
};

function renderDialog(
  open = true,
  overrides: {
    onOpenChange?: (open: boolean) => void;
    onSuccess?: () => void;
  } = {},
) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();
  const result = render(
    <I18nProvider initialLocale="zh">
      <MergeBranchDialog
        open={open}
        onOpenChange={onOpenChange}
        projectId={7}
        workspacePath="/tmp/repo"
        onSuccess={onSuccess}
      />
    </I18nProvider>,
  );
  return { ...result, onOpenChange, onSuccess };
}

describe("MergeBranchDialog", () => {
  beforeEach(() => {
    listMock.mockReset();
    fetchMock.mockReset();
    mergeMock.mockReset();
    toastSuccessMock.mockReset();
    listMock.mockResolvedValue(sampleResponse);
    fetchMock.mockResolvedValue(undefined);
    mergeMock.mockResolvedValue({ branch: "main" });
  });

  it("loads merge candidates without fetch and hides current local branch", async () => {
    renderDialog(true);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: "选择要合并的分支" }),
    ).toBeInTheDocument();
    expect(screen.getByText("feature-new")).toBeInTheDocument();
    expect(screen.getByText("feature-occupied")).toBeInTheDocument();
    expect(screen.getByText("origin/feature-remote")).toBeInTheDocument();
    expect(screen.getByText("本地分支")).toBeInTheDocument();
    expect(screen.getByText("远程分支")).toBeInTheDocument();
    const localButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent?.includes("base"));
    expect(localButtons).toHaveLength(0);
  });

  it("merges local branch, toasts, closes, and refreshes", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    await waitFor(() => {
      expect(mergeMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        kind: "local",
        name: "feature-new",
      });
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "已将 feature-new 合入 main",
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not merge remote branch in this ticket", async () => {
    renderDialog(true);
    await screen.findByText("origin/feature-remote");

    const remoteButton = screen
      .getAllByRole("button")
      .find((btn) => btn.textContent?.includes("origin/feature-remote"));
    expect(remoteButton).toBeTruthy();
    expect(remoteButton).toBeDisabled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("alerts dirty workspace and does not call merge", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ...sampleResponse,
      hasUncommittedChanges: true,
    });
    const { onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    const dialogs = await screen.findAllByRole("dialog");
    const alertDialog = dialogs.find((dialog) =>
      dialog.textContent?.includes("当前有未提交改动，请先处理后再合并。"),
    );
    expect(alertDialog).toBeTruthy();
    expect(mergeMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows error alert when merge fails", async () => {
    const user = userEvent.setup();
    mergeMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "Git command failed: mergeAbortedDueToConflict",
      reason: "mergeAbortedDueToConflict",
    });
    const { onOpenChange, onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    const dialogs = await screen.findAllByRole("dialog");
    const alertDialog = dialogs.find((dialog) =>
      dialog.textContent?.includes(
        "合并存在冲突，已中止合并，工作区保持干净。",
      ),
    );
    expect(alertDialog).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("refresh fetches remotes then reloads merge list", async () => {
    const user = userEvent.setup();
    renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByRole("button", { name: "刷新远程分支" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });
});
