import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { AlertDialog } from "./alert-dialog";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";
import { Input } from "./input";
import { Textarea } from "./textarea";

describe("desktop ui primitives", () => {
  it("renders shadcn button primitive", () => {
    render(<Button>Run</Button>);

    const button = screen.getByRole("button", { name: "Run" });

    expect(button).toHaveAttribute("data-slot", "button");
    expect(button.className).toContain("bg-primary");
  });

  it("renders shadcn input primitive", () => {
    render(<Input aria-label="Command" />);

    const input = screen.getByRole("textbox", { name: "Command" });

    expect(input).toHaveAttribute("data-slot", "input");
    expect(input.className).toContain("border-input");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("renders shadcn textarea primitive without automatic capitalization", () => {
    render(<Textarea aria-label="Prompt" />);

    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    expect(textarea).toHaveAttribute("data-slot", "textarea");
    expect(textarea).toHaveAttribute("autocapitalize", "none");
    expect(textarea).toHaveAttribute("spellcheck", "false");
  });

  it("confirms destructive action message-only dialog", async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        message="确认要删除吗？"
        confirmLabel="删除"
        confirmVariant="destructive"
        onConfirm={handleConfirm}
      >
        <Button>删除项目</Button>
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "删除项目" }));

    const dialog = screen.getByRole("dialog", { name: "确认要删除吗？" });
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(handleConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除项目" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders success alert dialog with status icon and acknowledgement action", () => {
    render(
      <AlertDialog
        acknowledgeLabel="知道了"
        message="操作已完成"
        open
        type="success"
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "操作已完成" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "知道了" })).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="alert-dialog-icon"]'),
    ).toHaveAttribute("data-type", "success");
  });
});
