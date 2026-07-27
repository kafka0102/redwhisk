import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { SYNC_CONFIRM_DISMISSED_STORAGE_KEY } from "../../shared/workspace/sync-changes";
import { toast } from "../../shared/toast";
import {
  pullProjectWorktree,
  pushProjectWorktree,
  type BranchSyncStatus,
} from "../../shared/workspace/workspace-commands";
import { useSyncChangesAction } from "./use-sync-changes-action";

vi.mock("../../shared/workspace/workspace-commands", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../shared/workspace/workspace-commands")
    >();
  return {
    ...actual,
    pullProjectWorktree: vi.fn(),
    pushProjectWorktree: vi.fn(),
  };
});

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const pullMock = vi.mocked(pullProjectWorktree);
const pushMock = vi.mocked(pushProjectWorktree);
const toastSuccessMock = vi.mocked(toast.success);

function Host({
  branchSync,
  onSuccess,
  workspacePath = "/tmp/repo",
}: {
  branchSync: BranchSyncStatus;
  onSuccess?: () => void;
  workspacePath?: string | null;
}) {
  const { requestSync, dialogs } = useSyncChangesAction({
    projectId: 7,
    workspacePath,
    onSuccess,
  });
  return (
    <>
      <button type="button" onClick={() => requestSync(branchSync)}>
        trigger-sync
      </button>
      {dialogs}
    </>
  );
}

function renderHost(
  branchSync: BranchSyncStatus,
  options: { onSuccess?: () => void; workspacePath?: string | null } = {},
) {
  return render(
    <I18nProvider initialLocale="zh">
      <Host
        branchSync={branchSync}
        onSuccess={options.onSuccess}
        workspacePath={options.workspacePath}
      />
    </I18nProvider>,
  );
}

describe("useSyncChangesAction", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pullMock.mockReset();
    pullMock.mockResolvedValue(undefined);
    pushMock.mockReset();
    pushMock.mockResolvedValue(undefined);
    toastSuccessMock.mockReset();
  });

  it("shows pull confirm, cancels without git ops", async () => {
    const user = userEvent.setup();
    renderHost({ upstream: "origin/main", ahead: 0, behind: 2 });

    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent('此操作将从 "origin/main" 中拉取提交。');
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(pullMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("pull-only confirms, loads, toasts, and refreshes", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    let resolvePull: (() => void) | undefined;
    pullMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePull = resolve;
        }),
    );

    renderHost({ upstream: "origin/main", ahead: 0, behind: 2 }, { onSuccess });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));

    expect(await screen.findByText("正在拉取…")).toBeInTheDocument();
    expect(pullMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: "/tmp/repo",
    });
    expect(pushMock).not.toHaveBeenCalled();

    resolvePull?.();
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("拉取成功");
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("正在拉取…")).not.toBeInTheDocument();
    });
  });

  it("push-only confirm message and execution", async () => {
    const user = userEvent.setup();
    renderHost({ upstream: "origin/main", ahead: 3, behind: 0 });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent('此操作将向 "origin/main" 推送提交。');
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
      });
    });
    expect(pullMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("推送成功");
    });
  });

  it("both directions pull then push and toast sync success", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    pullMock.mockImplementation(async () => {
      order.push("pull");
    });
    pushMock.mockImplementation(async () => {
      order.push("push");
    });

    renderHost({ upstream: "origin/main", ahead: 1, behind: 2 });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      '此操作将从 "origin/main" 中拉取并向其推送提交。',
    );
    await user.click(within(dialog).getByRole("button", { name: "确定" }));
    await waitFor(() => {
      expect(order).toEqual(["pull", "push"]);
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("同步成功");
    });
  });

  it("stops after pull failure and does not push", async () => {
    const user = userEvent.setup();
    pullMock.mockRejectedValue(new Error("pull failed"));
    renderHost({ upstream: "origin/main", ahead: 1, behind: 2 });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(pullMock).toHaveBeenCalled();
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("dismiss confirm skips later dialogs and runs immediately", async () => {
    const user = userEvent.setup();
    renderHost({ upstream: "origin/main", ahead: 0, behind: 1 });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "确定且不再显示" }),
    );
    await waitFor(() => {
      expect(pullMock).toHaveBeenCalledTimes(1);
    });
    expect(
      window.localStorage.getItem(SYNC_CONFIRM_DISMISSED_STORAGE_KEY),
    ).toBe("1");

    await waitFor(() => {
      expect(screen.queryByText("正在拉取…")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    expect(screen.queryByText(/此操作将/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(pullMock).toHaveBeenCalledTimes(2);
    });
  });

  it("refreshes after pull success even when push fails in both mode", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    pullMock.mockResolvedValue(undefined);
    pushMock.mockRejectedValue(new Error("push failed"));
    renderHost({ upstream: "origin/main", ahead: 1, behind: 2 }, { onSuccess });
    await user.click(screen.getByRole("button", { name: "trigger-sync" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(pullMock).toHaveBeenCalled();
      expect(pushMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
