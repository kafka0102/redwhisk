import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  checkoutProjectBranch,
  fetchProjectRemotes,
  listProjectCheckoutBranches,
} from "../../shared/workspace/workspace-commands";
import { CheckoutBranchDialog } from "./checkout-branch-dialog";
import { formatBranchRelativeTime } from "./checkout-branch-relative-time";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  listProjectCheckoutBranches: vi.fn(),
  fetchProjectRemotes: vi.fn(),
  checkoutProjectBranch: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const listMock = vi.mocked(listProjectCheckoutBranches);
const fetchMock = vi.mocked(fetchProjectRemotes);
const checkoutMock = vi.mocked(checkoutProjectBranch);
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
      <CheckoutBranchDialog
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

describe("formatBranchRelativeTime", () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (key === "changesCheckout.justNow") return "刚刚";
    if (key === "changesCheckout.minutesAgo")
      return `${options?.minutes} 分钟前`;
    if (key === "changesCheckout.hoursAgo") return `${options?.hours} 小时前`;
    if (key === "changesCheckout.daysAgo") return `${options?.days} 天前`;
    if (key === "changesCheckout.monthsAgo") return `${options?.months} 个月前`;
    return key;
  };

  it("covers minute hour day and month buckets", () => {
    const now = 1_700_000_000_000;
    expect(formatBranchRelativeTime(now - 30_000, t, now)).toBe("刚刚");
    expect(formatBranchRelativeTime(now - 5 * 60_000, t, now)).toBe("5 分钟前");
    expect(formatBranchRelativeTime(now - 3 * 3_600_000, t, now)).toBe(
      "3 小时前",
    );
    expect(formatBranchRelativeTime(now - 10 * 86_400_000, t, now)).toBe(
      "10 天前",
    );
    expect(formatBranchRelativeTime(now - 90 * 86_400_000, t, now)).toBe(
      "3 个月前",
    );
  });
});

describe("CheckoutBranchDialog", () => {
  beforeEach(() => {
    listMock.mockReset();
    fetchMock.mockReset();
    checkoutMock.mockReset();
    toastSuccessMock.mockReset();
    listMock.mockResolvedValue(sampleResponse);
    fetchMock.mockResolvedValue(undefined);
    checkoutMock.mockResolvedValue({ branch: "feature-new" });
  });

  it("loads branches without fetch on open and renders two sections", async () => {
    renderDialog(true);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(
      await screen.findByRole("heading", { name: "选择要签出的分支" }),
    ).toBeInTheDocument();
    expect(screen.getByText("feature-new")).toBeInTheDocument();
    expect(screen.getByText("origin/feature-remote")).toBeInTheDocument();
    expect(screen.getByText("本地分支")).toBeInTheDocument();
    expect(screen.getByText("远程分支")).toBeInTheDocument();
    expect(screen.getByText(/Alice · abc1234 · newest/)).toBeInTheDocument();
  });

  it("keeps the branch list inside the dialog with a vertical scrollbar", async () => {
    renderDialog(true);
    await screen.findByText("feature-new");

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/overflow-hidden/);
    expect(dialog.className).toMatch(/max-h-/);
    const scroller = dialog.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(screen.getByText("feature-new"));
    expect(scroller).toContainElement(
      screen.getByText("origin/feature-remote"),
    );
  });

  it("refresh runs fetch then re-lists and keeps list on refresh failure", async () => {
    const user = userEvent.setup();
    renderDialog(true);
    await screen.findByText("feature-new");

    fetchMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "network down",
      reason: "gitCommandFailed",
    });

    await user.click(screen.getByRole("button", { name: "刷新远程分支" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    // 失败时保留当前列表
    expect(screen.getByText("feature-new")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("successful refresh re-lists after fetch", async () => {
    const user = userEvent.setup();
    renderDialog(true);
    await screen.findByText("feature-new");
    listMock.mockClear();

    listMock.mockResolvedValueOnce({
      ...sampleResponse,
      remoteBranches: [
        ...sampleResponse.remoteBranches,
        {
          name: "origin/new-remote",
          authorName: "Dan",
          shortHash: "zzz111",
          message: "fresh",
          committedAt: Date.now(),
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "刷新远程分支" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(listMock).toHaveBeenCalled();
    });
    expect(await screen.findByText("origin/new-remote")).toBeInTheDocument();
  });

  it("checks out local branch, toasts, closes, and refreshes", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    await waitFor(() => {
      expect(checkoutMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        kind: "local",
        name: "feature-new",
      });
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("已签出到 feature-new");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("checks out remote branch", async () => {
    const user = userEvent.setup();
    checkoutMock.mockResolvedValueOnce({ branch: "feature-remote" });
    renderDialog(true);
    await screen.findByText("origin/feature-remote");

    await user.click(screen.getByText("origin/feature-remote"));

    await waitFor(() => {
      expect(checkoutMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        kind: "remote",
        name: "origin/feature-remote",
      });
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("已签出到 feature-remote");
    });
  });

  it("current branch click is no-op close without checkout", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSuccess } = renderDialog(true);
    await screen.findByText("main");

    // 列表中有两个 main 相关文本；点本地 main 行按钮
    const mainButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent?.includes("main"));
    const localMain = mainButtons.find((btn) =>
      btn.textContent?.includes("base"),
    );
    expect(localMain).toBeTruthy();
    await user.click(localMain!);

    expect(checkoutMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("dirty workspace confirms before checkout; cancel skips", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ...sampleResponse,
      hasUncommittedChanges: true,
    });
    const { onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    const confirmDialog = await screen.findByRole("dialog", {
      name: "切换分支",
    });
    expect(confirmDialog).toHaveTextContent(
      "当前有未提交代码，确定要切换分支吗？",
    );
    expect(checkoutMock).not.toHaveBeenCalled();

    await user.click(
      within(confirmDialog).getByRole("button", { name: "取消" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "切换分支" }),
      ).not.toBeInTheDocument();
    });
    expect(checkoutMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("dirty workspace confirm accept calls checkout", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      ...sampleResponse,
      hasUncommittedChanges: true,
    });
    const { onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));
    const confirmDialog = await screen.findByRole("dialog", {
      name: "切换分支",
    });
    await user.click(
      within(confirmDialog).getByRole("button", { name: "切换" }),
    );

    await waitFor(() => {
      expect(checkoutMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        kind: "local",
        name: "feature-new",
      });
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error alert when checkout fails", async () => {
    const user = userEvent.setup();
    checkoutMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "Git command failed: refused",
      reason: "gitCommandFailed",
      details: [
        {
          "@type": "Cause",
          message: "error: your local changes would be overwritten",
        },
      ],
    });
    const { onOpenChange, onSuccess } = renderDialog(true);
    await screen.findByText("feature-new");

    await user.click(screen.getByText("feature-new"));

    const dialogs = await screen.findAllByRole("dialog");
    const alertDialog = dialogs.find((d) =>
      d.textContent?.includes("Git 命令执行失败"),
    );
    expect(alertDialog).toBeTruthy();
    expect(alertDialog).toHaveTextContent(
      "error: your local changes would be overwritten",
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    // 失败时不关窗
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
