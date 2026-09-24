import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoadingDialog } from "./loading-dialog";

describe("LoadingDialog 焦点与关闭行为", () => {
  it("打开时默认焦点落在对话框容器，而非关闭按钮", async () => {
    render(<LoadingDialog closeLabel="关闭" message="正在打开项目…" open />);

    const dialog = await screen.findByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "关闭" });

    await waitFor(() => {
      expect(dialog).toHaveFocus();
    });
    expect(closeButton).not.toHaveFocus();
  });

  it("键盘 Tab 仍可聚焦关闭按钮并回车关闭", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <LoadingDialog
        closeLabel="关闭"
        message="正在打开项目…"
        onOpenChange={onOpenChange}
        open
      />,
    );

    const closeButton = screen.getByRole("button", { name: "关闭" });
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismissible 为 false 时不渲染关闭按钮", () => {
    render(
      <LoadingDialog
        closeLabel="关闭"
        dismissible={false}
        message="正在打开项目…"
        open
      />,
    );

    expect(screen.queryByLabelText("关闭")).not.toBeInTheDocument();
  });
});
