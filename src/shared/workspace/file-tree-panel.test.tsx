import {
  forwardRef,
  useImperativeHandle,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRendererProps } from "react-arborist";

import { I18nProvider } from "../i18n/i18n";
import { toast } from "../toast";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";
import {
  buildFileTreeDraftNode,
  isFileTreeDraftNodeId,
  type FileTreeEntryCreateInput,
} from "./file-tree-create-draft";
import {
  FileTreeDraftRow,
  FileTreeStatusBadge,
  type FileTreeDraftRowProps,
} from "./file-tree-row";
import { FileTreePanel } from "./file-tree-panel";
import {
  resetFileTreeScrollOffsetCacheForTests,
  writeFileTreeScrollOffset,
} from "./file-tree-scroll-offset";

type FileTreeRowRenderer = (
  props: NodeRendererProps<WorkspaceFileTreeNode>,
) => ReactNode;

const treeHeights: number[] = [];
const treeRowRenderers: FileTreeRowRenderer[] = [];
const treeDataSnapshots: WorkspaceFileTreeNode[][] = [];
const treeScrollTo = vi.fn();
const treeOpen = vi.fn();
const treeSelect = vi.fn();
const treeOnScrollHandlers: Array<
  (props: { scrollOffset: number; scrollUpdateWasRequested: boolean }) => void
> = [];

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

const toastSuccessMock = vi.mocked(toast.success);
const toastErrorMock = vi.mocked(toast.error);

vi.mock("react-arborist", () => ({
  Tree: forwardRef(function MockTree(
    {
      children,
      data,
      height,
      "aria-label": ariaLabel,
      onScroll,
    }: {
      children?: FileTreeRowRenderer;
      data?: WorkspaceFileTreeNode[];
      height: number;
      "aria-label"?: string;
      onScroll?: (props: {
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
      }) => void;
    },
    ref,
  ) {
    treeHeights.push(height);
    if (data) {
      treeDataSnapshots.push(data);
    }
    if (children) {
      treeRowRenderers.push(children);
    }
    if (onScroll) {
      treeOnScrollHandlers.push(onScroll);
    }
    useImperativeHandle(ref, () => ({
      list: { current: { scrollTo: treeScrollTo } },
      listEl: { current: null },
      open: treeOpen,
      select: treeSelect,
    }));
    return (
      <div
        aria-label={ariaLabel}
        data-testid="mock-file-tree"
        data-height={height}
      />
    );
  }),
}));

const sampleTree: WorkspaceFileTreeNode[] = [
  {
    id: "src",
    name: "src",
    path: "src",
    kind: "directory",
    isIgnored: false,
    children: [
      {
        id: "src/a.ts",
        name: "a.ts",
        path: "src/a.ts",
        kind: "file",
        isIgnored: false,
      },
    ],
  },
];

describe("FileTreePanel", () => {
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let observedElements: Element[] = [];

  beforeEach(() => {
    treeHeights.length = 0;
    treeRowRenderers.length = 0;
    treeDataSnapshots.length = 0;
    treeOnScrollHandlers.length = 0;
    treeScrollTo.mockReset();
    treeOpen.mockReset();
    treeSelect.mockReset();
    toastErrorMock.mockReset();
    resetFileTreeScrollOffsetCacheForTests();
    resizeObserverCallback = null;
    observedElements = [];

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }

      observe(element: Element) {
        observedElements.push(element);
      }

      disconnect() {
        observedElements = [];
      }

      unobserve() {}
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("measures viewport height after async file tree data mounts the tree", () => {
    // 复现：切到「文件」tab 时先 loading/空态，viewport 尚未挂载；
    // 数据返回后才渲染 Tree。测量逻辑必须在 viewport 首次出现时重新绑定。
    const { rerender } = renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={[]}
        isLoading
        onOpenFile={() => {}}
      />,
    );

    expect(document.querySelector(".session-file-tree__viewport")).toBeNull();
    expect(resizeObserverCallback).toBeNull();

    rerender(
      <I18nProvider fixedLocale="en">
        <FileTreePanel
          errorMessage={null}
          fileTree={[
            {
              id: "src",
              name: "src",
              path: "src",
              kind: "directory",
              children: [],
              isIgnored: false,
            },
          ]}
          isLoading={false}
          onOpenFile={() => {}}
        />
      </I18nProvider>,
    );

    const viewport = document.querySelector(
      ".session-file-tree__viewport",
    ) as HTMLDivElement | null;
    expect(viewport).not.toBeNull();
    expect(resizeObserverCallback).not.toBeNull();

    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      get: () => 842,
    });

    act(() => {
      resizeObserverCallback?.(
        [
          {
            target: viewport as Element,
            contentRect: {
              height: 842,
              width: 320,
              x: 0,
              y: 0,
              top: 0,
              left: 0,
              bottom: 842,
              right: 320,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        {} as ResizeObserver,
      );
    });

    expect(screen.getByTestId("mock-file-tree")).toHaveAttribute(
      "data-height",
      "842",
    );
    expect(treeHeights[treeHeights.length - 1]).toBe(842);
  });

  it("keeps the tree row renderer stable when unchanged props re-render", () => {
    const fileTree = [
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "directory" as const,
        children: [],
        isIgnored: false,
      },
    ];
    const onOpenFile = vi.fn();
    const { rerender } = renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={fileTree}
        isLoading={false}
        onOpenFile={onOpenFile}
      />,
    );
    const firstRenderer = treeRowRenderers[treeRowRenderers.length - 1];

    rerender(
      <I18nProvider fixedLocale="en">
        <FileTreePanel
          errorMessage={null}
          fileTree={fileTree}
          isLoading={false}
          onOpenFile={onOpenFile}
        />
      </I18nProvider>,
    );

    expect(treeRowRenderers[treeRowRenderers.length - 1]).toBe(firstRenderer);
  });

  it("restores cached scroll offset after remounting the same workspace", () => {
    writeFileTreeScrollOffset("/tmp/redwhisk", 420);
    renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={sampleTree}
        isLoading={false}
        onOpenFile={() => {}}
        workspacePath="/tmp/redwhisk"
      />,
    );
    expect(treeScrollTo).toHaveBeenCalledWith(420);
  });

  it("keeps scroll offset when the tree unmounts and mounts again", () => {
    const { unmount } = renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={sampleTree}
        isLoading={false}
        onOpenFile={() => {}}
        workspacePath="/tmp/redwhisk"
      />,
    );
    expect(treeOnScrollHandlers.length).toBeGreaterThan(0);
    act(() => {
      treeOnScrollHandlers[treeOnScrollHandlers.length - 1]({
        scrollOffset: 288,
        scrollUpdateWasRequested: false,
      });
    });
    unmount();
    treeScrollTo.mockReset();
    treeOnScrollHandlers.length = 0;

    renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={sampleTree}
        isLoading={false}
        onOpenFile={() => {}}
        workspacePath="/tmp/redwhisk"
      />,
    );
    expect(treeScrollTo).toHaveBeenCalledWith(288);
  });

  it("does not restore another workspace's scroll offset", () => {
    writeFileTreeScrollOffset("/tmp/redwhisk", 420);
    renderWithI18n(
      <FileTreePanel
        errorMessage={null}
        fileTree={sampleTree}
        isLoading={false}
        onOpenFile={() => {}}
        workspacePath="/tmp/other"
      />,
    );
    expect(treeScrollTo).not.toHaveBeenCalled();
  });

  it("colors file name and shows letter badge for changed files", () => {
    const row = renderTreeRow(
      {
        changedFileKinds: new Map([["src/a.ts", "modified"]]),
      },
      {
        id: "src/a.ts",
        name: "a.ts",
        path: "src/a.ts",
        kind: "file",
        isIgnored: false,
      },
    );

    const name = within(row).getByText("a.ts");
    expect(name).toHaveClass("session-file-tree__name");
    expect(name).toHaveClass("session-commit-file__status--modified");

    const badge = within(row).getByText("M");
    expect(badge).toHaveClass("session-file-tree__status");
    expect(badge).toHaveClass("session-commit-file__status--modified");
  });

  it("colors directory name without aggregated letter badge", () => {
    const row = renderTreeRow(
      {
        directoryKinds: new Map([["src", "deleted"]]),
      },
      {
        id: "src",
        name: "src",
        path: "src",
        kind: "directory",
        isIgnored: false,
        children: [],
      },
    );

    const name = within(row).getByText("src");
    expect(name).toHaveClass("session-file-tree__name");
    expect(name).toHaveClass("session-commit-file__status--deleted");
    expect(within(row).queryByText("D")).toBeNull();
    expect(row.querySelector(".session-file-tree__status")).toBeNull();
  });

  it("keeps default styling for unchanged file and directory rows", () => {
    const fileRow = renderTreeRow(
      {
        changedFileKinds: new Map([["other.ts", "added"]]),
        directoryKinds: new Map([["other", "added"]]),
      },
      {
        id: "plain.ts",
        name: "plain.ts",
        path: "plain.ts",
        kind: "file",
        isIgnored: false,
      },
    );
    const fileName = within(fileRow).getByText("plain.ts");
    expect(fileName).toHaveClass("session-file-tree__name");
    expect(fileName.className).not.toMatch(/session-commit-file__status--/);
    expect(fileRow.querySelector(".session-file-tree__status")).toBeNull();

    const directoryRow = renderTreeRow(
      {
        changedFileKinds: new Map([["other.ts", "added"]]),
        directoryKinds: new Map([["other", "added"]]),
      },
      {
        id: "lib",
        name: "lib",
        path: "lib",
        kind: "directory",
        isIgnored: false,
        children: [],
      },
    );
    const directoryName = within(directoryRow).getByText("lib");
    expect(directoryName).toHaveClass("session-file-tree__name");
    expect(directoryName.className).not.toMatch(
      /session-commit-file__status--/,
    );
    expect(directoryRow.querySelector(".session-file-tree__status")).toBeNull();
  });

  describe("workspace path context menu", () => {
    const writeTextMock = vi.fn();

    beforeEach(() => {
      toastSuccessMock.mockReset();
      writeTextMock.mockReset();
      writeTextMock.mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: writeTextMock },
      });
    });

    it("copies file name, relative path, and absolute path from the file row menu", async () => {
      const row = renderPanelAndOpenableRow(
        {
          id: "src/a.ts",
          name: "a.ts",
          path: "src/a.ts",
          kind: "file",
          isIgnored: false,
        },
        "/repo",
      );

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
      ]);

      fireEvent.click(items[0]);
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("a.ts");
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
      });

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy relative path" }),
      );
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("src/a.ts");
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
      });

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy absolute path" }),
      );
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("/repo/src/a.ts");
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
      });
    });

    it("uses the same copy menu for directory rows", async () => {
      const row = renderPanelAndOpenableRow(
        {
          id: "src",
          name: "src",
          path: "src",
          kind: "directory",
          isIgnored: false,
          children: [],
        },
        "/repo",
      );

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
      ]);

      fireEvent.click(items[0]);
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("src");
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied to clipboard");
      });

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy relative path" }),
      );
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("src");
      });

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy absolute path" }),
      );
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("/repo/src");
      });
    });

    it("hides copy absolute path when workspacePath is missing", async () => {
      const row = renderPanelAndOpenableRow(
        {
          id: "src/a.ts",
          name: "a.ts",
          path: "src/a.ts",
          kind: "file",
          isIgnored: false,
        },
        null,
      );

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Copy file name",
        "Copy relative path",
      ]);
      expect(
        screen.queryByRole("menuitem", { name: "Copy absolute path" }),
      ).toBeNull();
    });

    it("silently ignores clipboard write failure", async () => {
      writeTextMock.mockRejectedValue(new Error("denied"));
      const row = renderPanelAndOpenableRow(
        {
          id: "src/a.ts",
          name: "a.ts",
          path: "src/a.ts",
          kind: "file",
          isIgnored: false,
        },
        "/repo",
      );

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy file name" }),
      );

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith("a.ts");
      });
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("keeps the right-clicked row highlighted while the menu is open", async () => {
      const row = renderPanelAndOpenableRow(menuTargetFileNode, "/repo");
      expect(row).not.toHaveClass("session-file-tree__row--menu-target");

      fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
      const item = await screen.findByRole("menuitem", {
        name: "Copy file name",
      });

      // 菜单盖住指针后目标行的 :hover 不再成立，需靠菜单目标态保住底色。
      expect(renderMenuTargetRow()).toHaveClass(
        "session-file-tree__row--menu-target",
      );

      fireEvent.click(item);
      await waitFor(() => {
        expect(renderMenuTargetRow()).not.toHaveClass(
          "session-file-tree__row--menu-target",
        );
      });
    });
  });

  describe("inline create", () => {
    const createDirectoryNode: WorkspaceFileTreeNode = {
      id: "src",
      name: "src",
      path: "src",
      kind: "directory",
      isIgnored: false,
      children: [],
    };
    const createNestedFileNode: WorkspaceFileTreeNode = {
      id: "src/a.ts",
      name: "a.ts",
      path: "src/a.ts",
      kind: "file",
      isIgnored: false,
    };
    const createRootFileNode: WorkspaceFileTreeNode = {
      id: "a.ts",
      name: "a.ts",
      path: "a.ts",
      kind: "file",
      isIgnored: false,
    };

    it("shows the create items above the copy items when a capability is injected", async () => {
      const row = renderCreatePanelRow(vi.fn(), createDirectoryNode);

      const items = await openRowMenu(row);
      expect(items.map((item) => item.textContent)).toEqual([
        "New File",
        "New Folder",
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
      ]);
    });

    it("inserts the draft row in front of the target directory children", async () => {
      const onDirectoryOpen = vi.fn();
      const row = renderCreatePanelRow(
        vi.fn(),
        createDirectoryNode,
        onDirectoryOpen,
      );

      await startDraft(row, "New File");

      // 折叠 / 未加载的目标目录要先展开并拉取该层，草稿行才可见。
      expect(treeOpen).toHaveBeenCalledWith("src");
      expect(onDirectoryOpen).toHaveBeenCalledWith("src");
      const tree = latestTreeData();
      const draftNode = findDraftNode(tree);
      expect(draftNode).not.toBeNull();
      expect(draftNode?.kind).toBe("file");
      expect(tree[0].children?.[0]).toBe(draftNode);
      expect(tree[0].children?.[1].path).toBe("src/a.ts");

      const draftRow = renderDraftRowElement();
      expect(
        within(draftRow).getByRole("textbox", { name: "New File" }),
      ).toHaveFocus();
    });

    it("attributes a root level file row to the code root", async () => {
      const row = renderCreatePanelRow(vi.fn(), createRootFileNode);

      await startDraft(row, "New Folder");

      const tree = latestTreeData();
      expect(findDraftNode(tree)).toBe(tree[0]);
    });

    it("creates the entry on Enter and attributes it to the parent directory", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createNestedFileNode);
      await startDraft(row, "New File");

      submitDraftedName("new.ts");

      await waitFor(() => {
        expect(onCreateEntry).toHaveBeenCalledWith({
          directoryPath: "src",
          kind: "file",
          name: "new.ts",
        });
      });
      await waitFor(() => {
        expect(findDraftNode(latestTreeData())).toBeNull();
      });
    });

    it("creates the entry when the input loses focus with a non-empty name", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New Folder");

      blurDraftedName("nested");

      await waitFor(() => {
        expect(onCreateEntry).toHaveBeenCalledWith({
          directoryPath: "src",
          kind: "directory",
          name: "nested",
        });
      });
    });

    it("cancels the draft on Escape without creating", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New File");

      pressDraftedKey("Escape");

      expect(findDraftNode(latestTreeData())).toBeNull();
      expect(onCreateEntry).not.toHaveBeenCalled();
    });

    it("cancels the draft on empty blur without creating", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New File");

      blurDraftedName("   ");

      expect(findDraftNode(latestTreeData())).toBeNull();
      expect(onCreateEntry).not.toHaveBeenCalled();
    });

    it("cancels the draft on empty submit without creating", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New File");

      submitDraftedName("");

      expect(findDraftNode(latestTreeData())).toBeNull();
      expect(onCreateEntry).not.toHaveBeenCalled();
    });

    it("does not create an invalid name and reports it", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New File");

      submitDraftedName("nested/new.ts");

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Name is invalid. It cannot contain / or be . or ..",
        );
      });
      expect(onCreateEntry).not.toHaveBeenCalled();
      expect(findDraftNode(latestTreeData())).not.toBeNull();
    });

    it("keeps the draft row and reports the failure when creation fails", async () => {
      const onCreateEntry = vi.fn().mockRejectedValue({
        code: "AGENT_SESSION_VALIDATION_FAILED",
        message: "新建路径失败。",
        reason: "pathAlreadyExists",
      });
      const row = renderCreatePanelRow(onCreateEntry, createDirectoryNode);
      await startDraft(row, "New File");

      submitDraftedName("dup.ts");

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith("Target already exists.");
      });
      expect(findDraftNode(latestTreeData())).not.toBeNull();

      const draftRow = renderDraftRowElement();
      expect(
        within(draftRow).getByRole("textbox", { name: "New File" }),
      ).toHaveAttribute("aria-invalid", "true");
    });

    it("expands and selects the created directory once the tree data contains it", async () => {
      const onCreateEntry = vi.fn().mockResolvedValue(undefined);
      const view = renderCreatePanel(onCreateEntry);
      const row = renderTreeRowElement(createDirectoryNode);
      await startDraft(row, "New Folder");
      submitDraftedName("nested");
      await waitFor(() => {
        expect(onCreateEntry).toHaveBeenCalled();
      });

      view.rerender(
        <I18nProvider fixedLocale="en">
          <FileTreePanel
            errorMessage={null}
            fileTree={[
              {
                ...createDirectoryNode,
                children: [
                  {
                    id: "src/nested",
                    name: "nested",
                    path: "src/nested",
                    kind: "directory",
                    isIgnored: false,
                  },
                ],
              },
            ]}
            isLoading={false}
            onOpenFile={() => {}}
            workspacePath="/repo"
            onCreateEntry={onCreateEntry}
          />
        </I18nProvider>,
      );

      expect(treeOpen).toHaveBeenCalledWith("src/nested");
      expect(treeSelect).toHaveBeenCalledWith("src/nested");
    });

    it("expands and selects the created directory when the listing lands first", async () => {
      // 新建时强刷的 listing 有可能早于创建承诺落地；两种先后顺序都要落到展开选中。
      let resolveCreate: () => void = () => {};
      const onCreateEntry = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCreate = resolve;
          }),
      );
      const view = renderCreatePanel(onCreateEntry);
      const row = renderTreeRowElement(createDirectoryNode);
      await startDraft(row, "New Folder");
      submitDraftedName("nested");
      await waitFor(() => {
        expect(onCreateEntry).toHaveBeenCalled();
      });

      view.rerender(
        <I18nProvider fixedLocale="en">
          <FileTreePanel
            errorMessage={null}
            fileTree={[
              {
                ...createDirectoryNode,
                children: [
                  {
                    id: "src/nested",
                    name: "nested",
                    path: "src/nested",
                    kind: "directory",
                    isIgnored: false,
                  },
                ],
              },
            ]}
            isLoading={false}
            onOpenFile={() => {}}
            workspacePath="/repo"
            onCreateEntry={onCreateEntry}
          />
        </I18nProvider>,
      );
      expect(treeSelect).not.toHaveBeenCalled();

      act(() => {
        resolveCreate();
      });

      await waitFor(() => {
        expect(treeOpen).toHaveBeenCalledWith("src/nested");
        expect(treeSelect).toHaveBeenCalledWith("src/nested");
      });
    });
  });

  describe("draft row", () => {
    it("keeps the typed name and re-selects it after a failed creation", () => {
      const onSubmit = vi.fn();
      const props = buildDraftRowProps({ onSubmit });
      const view = renderWithI18n(<FileTreeDraftRow {...props} />);
      const input = screen.getByRole("textbox", {
        name: "New File",
      }) as HTMLInputElement;

      fireEvent.change(input, { target: { value: "dup.ts" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSubmit).toHaveBeenCalledWith("dup.ts");

      view.rerender(
        <I18nProvider fixedLocale="en">
          <FileTreeDraftRow
            {...buildDraftRowProps({ onSubmit })}
            errorMessage="Target already exists."
            errorRevision={1}
          />
        </I18nProvider>,
      );

      expect(screen.getByRole("textbox", { name: "New File" })).toHaveValue(
        "dup.ts",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe("dup.ts".length);
    });
  });
});

const menuTargetFileNode: WorkspaceFileTreeNode = {
  id: "src/a.ts",
  name: "a.ts",
  path: "src/a.ts",
  kind: "file",
  isIgnored: false,
};

/** 用面板最近一次的行渲染器渲染目标行，读取菜单打开期间的行状态。 */
function renderMenuTargetRow(): HTMLElement {
  const renderer = treeRowRenderers[treeRowRenderers.length - 1];
  expect(renderer).toBeTypeOf("function");
  const rowElement = renderer({
    node: {
      data: menuTargetFileNode,
      level: 0,
      isOpen: false,
      toggle: () => {},
    },
    style: {},
  } as NodeRendererProps<WorkspaceFileTreeNode>) as ReactElement;
  const { container } = render(rowElement);
  return container.firstElementChild as HTMLElement;
}

function renderWithI18n(component: ReactNode) {
  return render(<I18nProvider fixedLocale="en">{component}</I18nProvider>);
}

function renderPanelAndOpenableRow(
  nodeData: WorkspaceFileTreeNode,
  workspacePath?: string | null,
): HTMLElement {
  renderWithI18n(
    <FileTreePanel
      errorMessage={null}
      fileTree={sampleTree}
      isLoading={false}
      onOpenFile={() => {}}
      workspacePath={workspacePath}
    />,
  );

  const renderer = treeRowRenderers[treeRowRenderers.length - 1];
  expect(renderer).toBeTypeOf("function");

  const rowElement = renderer({
    node: {
      data: nodeData,
      level: 0,
      isOpen: false,
      toggle: () => {},
    },
    style: {},
  } as NodeRendererProps<WorkspaceFileTreeNode>) as ReactElement;

  const { container } = render(rowElement);
  const row = container.firstElementChild;
  expect(row).toBeInstanceOf(HTMLElement);
  return row as HTMLElement;
}

function renderTreeRow(
  panelProps: {
    changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
    directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  },
  nodeData: WorkspaceFileTreeNode,
): HTMLElement {
  renderWithI18n(
    <FileTreePanel
      changedFileKinds={panelProps.changedFileKinds}
      directoryKinds={panelProps.directoryKinds}
      errorMessage={null}
      fileTree={sampleTree}
      isLoading={false}
      onOpenFile={() => {}}
    />,
  );

  const renderer = treeRowRenderers[treeRowRenderers.length - 1];
  expect(renderer).toBeTypeOf("function");

  const rowElement = renderer({
    node: {
      data: nodeData,
      level: 0,
      isOpen: false,
      toggle: () => {},
    },
    style: {},
  } as NodeRendererProps<WorkspaceFileTreeNode>) as ReactElement;

  const { container } = render(rowElement);
  const row = container.firstElementChild;
  expect(row).toBeInstanceOf(HTMLElement);
  return row as HTMLElement;
}

/** 渲染带「新建文件 / 新建文件夹」能力的面板，返回可 rerender 的视图。 */
function renderCreatePanel(
  onCreateEntry: (input: FileTreeEntryCreateInput) => Promise<void>,
  onDirectoryOpen: (directoryPath: string) => void = () => {},
): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <FileTreePanel
      errorMessage={null}
      fileTree={sampleTree}
      isLoading={false}
      onDirectoryOpen={onDirectoryOpen}
      onOpenFile={() => {}}
      workspacePath="/repo"
      onCreateEntry={onCreateEntry}
    />,
  );
}

/** 渲染带能力的面板，并用手动渲染的行打开菜单（arborist 行在测试里不虚拟化）。 */
function renderCreatePanelRow(
  onCreateEntry: (input: FileTreeEntryCreateInput) => Promise<void>,
  nodeData: WorkspaceFileTreeNode,
  onDirectoryOpen?: (directoryPath: string) => void,
): HTMLElement {
  renderCreatePanel(onCreateEntry, onDirectoryOpen);
  return renderTreeRowElement(nodeData);
}

/** 用面板最近一次的行渲染器渲染目标行，取回真实 DOM。 */
function renderTreeRowElement(
  nodeData: WorkspaceFileTreeNode,
  level = 0,
): HTMLElement {
  const renderer = treeRowRenderers[treeRowRenderers.length - 1];
  expect(renderer).toBeTypeOf("function");
  const rowElement = renderer({
    node: {
      data: nodeData,
      level,
      isOpen: false,
      toggle: () => {},
    },
    style: {},
  } as NodeRendererProps<WorkspaceFileTreeNode>) as ReactElement;
  const { container } = render(rowElement);
  const row = container.firstElementChild;
  expect(row).toBeInstanceOf(HTMLElement);
  return row as HTMLElement;
}

function latestTreeData(): WorkspaceFileTreeNode[] {
  return treeDataSnapshots[treeDataSnapshots.length - 1] ?? [];
}

function findDraftNode(
  nodes: readonly WorkspaceFileTreeNode[],
): WorkspaceFileTreeNode | null {
  for (const node of nodes) {
    if (isFileTreeDraftNodeId(node.id)) {
      return node;
    }
    const nested = findDraftNode(node.children ?? []);
    if (nested) {
      return nested;
    }
  }
  return null;
}

/** 打开右键菜单并取回菜单项（菜单项点击后菜单即关闭）。 */
async function openRowMenu(row: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
  return screen.findAllByRole("menuitem");
}

/** 打开右键菜单并点击「新建文件 / 新建文件夹」，让面板进入草稿行状态。 */
async function startDraft(
  row: HTMLElement,
  itemName: "New File" | "New Folder",
): Promise<void> {
  fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
  fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
}

/** 从面板最近一次交给 Tree 的数据里取出草稿节点并渲染草稿行。 */
function renderDraftRowElement(): HTMLElement {
  const draftNode = findDraftNode(latestTreeData());
  expect(draftNode).not.toBeNull();
  return renderTreeRowElement(draftNode as WorkspaceFileTreeNode, 1);
}

function freshDraftInput(): HTMLInputElement {
  return within(renderDraftRowElement()).getByRole(
    "textbox",
  ) as HTMLInputElement;
}

function submitDraftedName(name: string): void {
  const input = freshDraftInput();
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function blurDraftedName(name: string): void {
  const input = freshDraftInput();
  fireEvent.change(input, { target: { value: name } });
  fireEvent.blur(input);
}

function pressDraftedKey(key: string): void {
  fireEvent.keyDown(freshDraftInput(), { key });
}

function buildDraftRowProps(
  overrides: { onSubmit?: (name: string) => void } = {},
): FileTreeDraftRowProps {
  return {
    errorMessage: null,
    errorRevision: 0,
    node: {
      data: buildFileTreeDraftNode({ directoryPath: "src", kind: "file" }),
      isOpen: false,
      level: 1,
      toggle: () => {},
    },
    onCancel: () => {},
    onSubmit: overrides.onSubmit ?? (() => {}),
    style: {},
  } as unknown as FileTreeDraftRowProps;
}

describe("FileTreeStatusBadge", () => {
  it.each([
    ["added", "A", "session-commit-file__status--added"],
    ["untracked", "A", "session-commit-file__status--added"],
    ["modified", "M", "session-commit-file__status--modified"],
    ["deleted", "D", "session-commit-file__status--deleted"],
  ] as const)(
    "renders the %s status with letter %s and matching color class",
    (kind, letter, colorClass) => {
      render(<FileTreeStatusBadge kind={kind as WorkspaceChangeKind} />);
      const badge = screen.getByText(letter);
      expect(badge).toHaveClass("session-file-tree__status");
      expect(badge).toHaveClass(colorClass);
    },
  );
});
