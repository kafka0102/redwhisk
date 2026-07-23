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

    await user.click(screen.getByRole("button", { name: "Cancel" }));
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

  it("keeps long push error text and acknowledge action inside a wider alert dialog", () => {
    const longMessage = [
      "error: failed to push some refs to 'https://github.com/example/very-long-org-name/very-long-repo-name.git'",
      "hint: Updates were rejected because the remote contains work that you do not have locally.",
      "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
    ].join("\n");

    render(
      <AlertDialog
        acknowledgeLabel="知道了"
        message={longMessage}
        open
        type="error"
      />,
    );

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("sm:max-w-xl");
    expect(content?.className).toContain("min-w-0");
    expect(content?.className).toContain("overflow-hidden");

    const message = content?.querySelector("span.min-w-0");
    expect(message).not.toBeNull();
    expect(message?.textContent).toBe(longMessage);
    expect(message?.className).toContain("break-words");
    expect(message?.className).toContain("whitespace-pre-wrap");
    expect(message?.className).toContain("min-w-0");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(
      screen.getByRole("button", { name: "知道了" }),
    );
    expect(
      document.querySelector('[data-slot="alert-dialog-icon"]'),
    ).toHaveAttribute("data-type", "error");
  });
});
