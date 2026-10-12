import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import type { FileTreeEntryCreateInput } from "./file-tree-create-draft";
import { FileTreePanel } from "./file-tree-panel";
import type { WorkspaceFileTreeNode } from "./workspace-commands";

const alphaFile: WorkspaceFileTreeNode = {
  id: "alpha.ts",
  isIgnored: false,
  kind: "file",
  name: "alpha.ts",
  path: "alpha.ts",
};

async function openDraft(
  kind: "New File" | "New Folder",
  onCreateEntry: (input: FileTreeEntryCreateInput) => Promise<void>,
): Promise<HTMLInputElement> {
  render(
    <I18nProvider fixedLocale="en">
      <FileTreePanel
        errorMessage={null}
        fileTree={[alphaFile]}
        isLoading={false}
        onCreateEntry={onCreateEntry}
        onOpenFile={() => {}}
        workspacePath="/repo"
      />
    </I18nProvider>,
  );
  const row = await screen.findByRole("button", { name: "alpha.ts" });
  fireEvent.contextMenu(row, { clientX: 12, clientY: 12 });
  fireEvent.click(await screen.findByRole("menuitem", { name: kind }));
  return (await screen.findByRole("textbox", {
    name: kind,
  })) as HTMLInputElement;
}

describe("file tree draft typing", () => {
  it.each(["New File", "New Folder"] as const)(
    "keeps a %s draft while typing across a pause, then creates it on Enter",
    async (kind) => {
      const user = userEvent.setup();
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const input = await openDraft(kind, onCreateEntry);

      // 可见节点 alpha.ts 的前缀是 "a"。停顿超过 arborist 前缀搜索的 600ms
      // 后，单独的 "a" 会把焦点抢到该行，非空失焦被当成提交。
      await user.type(input, "z", { skipClick: true });
      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
      await user.type(input, "a", { skipClick: true });

      expect(onCreateEntry).not.toHaveBeenCalled();
      expect(input).toHaveValue("za");
      expect(input).toHaveFocus();

      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(onCreateEntry).toHaveBeenCalledWith({
          directoryPath: "",
          kind: kind === "New File" ? "file" : "directory",
          name: "za",
        });
      });
    },
  );

  it("does not create when the draft input itself is clicked", async () => {
    const user = userEvent.setup();
    const onCreateEntry = vi.fn().mockResolvedValue(undefined);
    const input = await openDraft("New File", onCreateEntry);

    await user.type(input, "z", { skipClick: true });
    await user.click(input);

    expect(onCreateEntry).not.toHaveBeenCalled();
    expect(input).toHaveValue("z");
    expect(input).toHaveFocus();
  });
});
