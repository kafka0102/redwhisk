import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { FileTreePanel } from "./file-tree-panel";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("../toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
  },
}));

const fileNode: WorkspaceFileTreeNode = {
  id: "docs/change-fields-plus.md",
  name: "change-fields-plus.md",
  path: "docs/change-fields-plus.md",
  kind: "file",
  isIgnored: false,
};

describe("file tree rename editing", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  it("deletes the character before the caret instead of the final character", async () => {
    const user = userEvent.setup();
    renderRenameTree();
    await openRename();

    const input = renameInput();
    const caret = input.value.indexOf("plus") + "plu".length;
    expect(input.value[caret - 1]).toBe("u");
    input.focus();
    input.setSelectionRange(caret, caret);

    await user.keyboard("{Backspace}");

    const edited = renameInput();
    expect(edited).toBe(input);
    expect(edited).toHaveValue("change-fields-pls.md");
    expect(edited.selectionStart).toBe(caret - 1);
  });

  it("keeps an in-progress composition in the same input at the caret", () => {
    renderRenameTree();
    openRename();

    const input = renameInput();
    const caret = input.value.indexOf("plus") + "plu".length;
    input.focus();
    input.setSelectionRange(caret, caret);
    const composed = `${input.value.slice(0, caret)}ni${input.value.slice(caret)}`;

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: composed } });

    const edited = renameInput();
    expect(edited).toBe(input);
    expect(edited).toHaveValue("change-fields-plunis.md");
  });
});

function renderRenameTree(): void {
  render(
    <I18nProvider fixedLocale="en">
      <FileTreePanel
        errorMessage={null}
        fileTree={[fileNode]}
        isLoading={false}
        workspacePath="/repo"
        onCreateEntry={vi.fn(async () => undefined)}
        onDeleteEntry={vi.fn()}
        onOpenFile={() => {}}
        onTransferEntry={vi.fn(async () => undefined)}
      />
    </I18nProvider>,
  );
}

function openRename(): void {
  fireEvent.contextMenu(screen.getByRole("button", { name: fileNode.name }), {
    clientX: 12,
    clientY: 24,
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
}

function renameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Rename" }) as HTMLInputElement;
}
