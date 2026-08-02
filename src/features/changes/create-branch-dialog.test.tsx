import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import { createProjectBranch } from "../../shared/workspace/workspace-commands";
import { CreateBranchDialog } from "./create-branch-dialog";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  createProjectBranch: vi.fn(),
}));

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const createMock = vi.mocked(createProjectBranch);
const toastSuccessMock = vi.mocked(toast.success);

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
      <CreateBranchDialog
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

describe("CreateBranchDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    toastSuccessMock.mockReset();
    createMock.mockResolvedValue({ branch: "feature-x" });
  });

  it("renders 400px dialog with empty input, placeholder, confirm and cancel", () => {
    renderDialog(true);

    expect(
      screen.getByRole("heading", { name: "创建分支" }),
    ).toBeInTheDocument();
    const input = screen.getByPlaceholderText("请输入分支名（基于当前分支名）");
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    const content = document.querySelector('[class*="max-w-[400px]"]');
    expect(content).not.toBeNull();
  });

  it("submits branch name without client-side validation and refreshes on success", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSuccess } = renderDialog(true);

    await user.type(
      screen.getByPlaceholderText("请输入分支名（基于当前分支名）"),
      "feature-x",
    );
    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        name: "feature-x",
      });
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("allows empty name submit so backend/git can reject", async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce({
      message: "git failed",
    });
    renderDialog(true);

    await user.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        projectId: 7,
        workspacePath: "/tmp/repo",
        name: "",
      });
    });
    // dialog stays open for retry after error alert path
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("cancel closes without invoking create", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog(true);

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(createMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
