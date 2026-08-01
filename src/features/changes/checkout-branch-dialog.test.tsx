import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import {
  fetchProjectRemotes,
  listProjectCheckoutBranches,
} from "../../shared/workspace/workspace-commands";
import { CheckoutBranchDialog } from "./checkout-branch-dialog";
import { formatBranchRelativeTime } from "./checkout-branch-relative-time";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  listProjectCheckoutBranches: vi.fn(),
  fetchProjectRemotes: vi.fn(),
}));

const listMock = vi.mocked(listProjectCheckoutBranches);
const fetchMock = vi.mocked(fetchProjectRemotes);

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

function renderDialog(open = true) {
  return render(
    <I18nProvider initialLocale="zh">
      <CheckoutBranchDialog
        open={open}
        onOpenChange={vi.fn()}
        projectId={7}
        workspacePath="/tmp/repo"
      />
    </I18nProvider>,
  );
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
    listMock.mockResolvedValue(sampleResponse);
    fetchMock.mockResolvedValue(undefined);
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
});
