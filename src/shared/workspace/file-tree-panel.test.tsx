import {
  createElement,
  forwardRef,
  useImperativeHandle,
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
import { findFileTreeNode } from "./file-tree-listings";
import {
  FileTreeDraftRow,
  FileTreeStatusBadge,
  type FileTreeDraftRowProps,
} from "./file-tree-row";
import {
  FileTreeRowModelContext,
  readFileTreeRowModel,
} from "./file-tree-row-model";
import {
  FileTreePanel,
  type FileTreeEntryDeleteInput,
} from "./file-tree-panel";
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
const treeClose = vi.fn();
const treeOpenState: Record<string, boolean> = {};
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

const revealItemInDir = vi.hoisted(() => vi.fn());
const openPath = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
  revealItemInDir,
}));

vi.mock("react-arborist", () => ({
  Tree: forwardRef(function MockTree(
    {
      children,
      data,
      height,
      "aria-label": ariaLabel,
      initialOpenState,
      onScroll,
    }: {
      children?: FileTreeRowRenderer;
      data?: WorkspaceFileTreeNode[];
      height: number;
      "aria-label"?: string;
      initialOpenState?: Record<string, boolean>;
      onScroll?: (props: {
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
      }) => void;
    },
    ref,
  ) {
    if (initialOpenState) {
      for (const [path, isOpen] of Object.entries(initialOpenState)) {
        if (!(path in treeOpenState)) {
          treeOpenState[path] = isOpen;
        }
      }
    }
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
      close: (id: string) => {
        treeOpenState[id] = false;
        treeClose(id);
      },
      open: treeOpen,
      get openState() {
        return treeOpenState;
      },
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
    treeClose.mockReset();
    for (const path of Object.keys(treeOpenState)) {
      delete treeOpenState[path];
    }
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

    it("opens the directory itself in Finder from a directory row", async () => {
      const previousPlatform = navigator.platform;
      setNavigatorPlatform("MacIntel");
      openPath.mockReset();
      revealItemInDir.mockReset();
      openPath.mockResolvedValue(undefined);
      revealItemInDir.mockResolvedValue(undefined);

      try {
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
        fireEvent.click(
          await screen.findByRole("menuitem", { name: "Open in Finder" }),
        );

        await waitFor(() => {
          expect(openPath).toHaveBeenCalledWith("/repo/src");
        });
        expect(revealItemInDir).not.toHaveBeenCalled();
      } finally {
        setNavigatorPlatform(previousPlatform);
      }
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
        "Cut",
        "Copy",
        "Paste",
        "Rename",
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

      await startDraft(row, "New File");

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

  describe("delete path", () => {
    const deleteFileNode: WorkspaceFileTreeNode = {
      id: "src/a.ts",
      name: "a.ts",
      path: "src/a.ts",
      kind: "file",
      isIgnored: false,
    };

    it("shows the delete item below the copy items for a file row", async () => {
      const onDeleteEntry = vi.fn();
      renderDeletePanel(onDeleteEntry);
      const row = renderTreeRowElement(deleteFileNode);

      const items = await openRowMenu(row);
      expect(items.map((item) => item.textContent)).toEqual([
        "New File",
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
        "Cut",
        "Copy",
        "Paste",
        "Rename",
        "Delete",
      ]);

      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(onDeleteEntry).toHaveBeenCalledWith({
        displayName: "a.ts",
        kind: "file",
        relativePath: "src/a.ts",
      });
    });

    it("omits New Folder on a file row and shows cut, copy, paste, and rename", async () => {
      const onDeleteEntry = vi.fn();
      renderDeletePanel(onDeleteEntry);
      const row = renderTreeRowElement(deleteFileNode);

      const items = await openRowMenu(row);
      expect(items.map((item) => item.textContent)).toEqual([
        "New File",
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
        "Cut",
        "Copy",
        "Paste",
        "Rename",
        "Delete",
      ]);
      expect(screen.queryByRole("menuitem", { name: "New Folder" })).toBeNull();
      expect(
        screen.queryByRole("menuitem", { name: "Open in Finder" }),
      ).toBeNull();
      expect(
        document.querySelectorAll('[data-slot="context-menu-separator"]'),
      ).toHaveLength(3);
      const paste = screen.getByRole("menuitem", { name: "Paste" });
      expect(
        paste.getAttribute("aria-disabled") === "true" ||
          paste.hasAttribute("data-disabled"),
      ).toBe(true);
    });

    it("deletes the directory itself from a directory row menu", async () => {
      const onDeleteEntry = vi.fn();
      renderDeletePanel(onDeleteEntry);
      const row = renderTreeRowElement({
        id: "src",
        name: "src",
        path: "src",
        kind: "directory",
        isIgnored: false,
        children: [],
      });

      const items = await openRowMenu(row);
      expect(items[items.length - 1].textContent).toBe("Delete");

      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(onDeleteEntry).toHaveBeenCalledWith({
        displayName: "src",
        kind: "directory",
        relativePath: "src",
      });
    });

    it("hides the delete item when no delete capability is injected", async () => {
      const onDeleteEntry = vi.fn();
      renderWithI18n(
        <FileTreePanel
          errorMessage={null}
          fileTree={sampleTree}
          isLoading={false}
          onOpenFile={() => {}}
          workspacePath="/repo"
          onCreateEntry={vi.fn()}
        />,
      );
      const row = renderTreeRowElement(deleteFileNode);

      const items = await openRowMenu(row);
      expect(items.map((item) => item.textContent)).toEqual([
        "New File",
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
        "Cut",
        "Copy",
        "Paste",
        "Rename",
      ]);
      expect(onDeleteEntry).not.toHaveBeenCalled();
    });
  });

  describe("path clipboard and rename", () => {
    const writeText = vi.fn();
    const appFile: WorkspaceFileTreeNode = {
      id: "src/app.tsx",
      isIgnored: false,
      kind: "file",
      name: "app.tsx",
      path: "src/app.tsx",
    };
    const mainFile: WorkspaceFileTreeNode = {
      id: "src/main.ts",
      isIgnored: false,
      kind: "file",
      name: "main.ts",
      path: "src/main.ts",
    };
    const buttonFile: WorkspaceFileTreeNode = {
      id: "src/components/button.tsx",
      isIgnored: false,
      kind: "file",
      name: "button.tsx",
      path: "src/components/button.tsx",
    };
    const uiDir: WorkspaceFileTreeNode = {
      children: [],
      id: "src/components/ui",
      isIgnored: false,
      kind: "directory",
      name: "ui",
      path: "src/components/ui",
    };
    const nestedComponents: WorkspaceFileTreeNode = {
      children: [buttonFile, uiDir],
      id: "src/components",
      isIgnored: false,
      kind: "directory",
      name: "components",
      path: "src/components",
    };
    const srcDir: WorkspaceFileTreeNode = {
      children: [appFile, mainFile, nestedComponents],
      id: "src",
      isIgnored: false,
      kind: "directory",
      name: "src",
      path: "src",
    };
    const rootComponents: WorkspaceFileTreeNode = {
      children: [],
      id: "components",
      isIgnored: false,
      kind: "directory",
      name: "components",
      path: "components",
    };
    const occupiedComponents: WorkspaceFileTreeNode = {
      children: [
        {
          id: "components/app.tsx",
          isIgnored: false,
          kind: "file",
          name: "app.tsx",
          path: "components/app.tsx",
        },
      ],
      id: "components",
      isIgnored: false,
      kind: "directory",
      name: "components",
      path: "components",
    };
    const libDir: WorkspaceFileTreeNode = {
      children: [],
      id: "lib",
      isIgnored: false,
      kind: "directory",
      name: "lib",
      path: "lib",
    };
    const gitignore: WorkspaceFileTreeNode = {
      id: ".gitignore",
      isIgnored: false,
      kind: "file",
      name: ".gitignore",
      path: ".gitignore",
    };
    const appTest: WorkspaceFileTreeNode = {
      id: "app.test.tsx",
      isIgnored: false,
      kind: "file",
      name: "app.test.tsx",
      path: "app.test.tsx",
    };
    const clipboardTree = [srcDir, rootComponents, libDir, gitignore, appTest];

    beforeEach(() => {
      writeText.mockReset();
      writeText.mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
    });

    function renderEditable(
      fileTree: WorkspaceFileTreeNode[],
      options: {
        initialOpenState?: Record<string, boolean>;
        locale?: "en" | "zh";
        onOpenFile?: (file: WorkspaceFileTreeNode) => void;
        onOpenStateChange?: (openState: Record<string, boolean>) => void;
        onTransferEntry?: (input: {
          destinationDirectory: string;
          destinationPath: string;
          operation: "copy" | "move";
          sourceDirectory: string;
          sourcePath: string;
        }) => Promise<void>;
        workspacePath?: string | null;
      } = {},
    ) {
      return render(
        <I18nProvider fixedLocale={options.locale ?? "en"}>
          <FileTreePanel
            errorMessage={null}
            fileTree={fileTree}
            initialOpenState={options.initialOpenState}
            isLoading={false}
            workspacePath={
              options.workspacePath === undefined
                ? "/repo"
                : options.workspacePath
            }
            onCreateEntry={vi.fn(async () => undefined)}
            onDeleteEntry={vi.fn()}
            onOpenFile={options.onOpenFile ?? (() => {})}
            onOpenStateChange={options.onOpenStateChange}
            onTransferEntry={options.onTransferEntry}
          />
        </I18nProvider>,
      );
    }

    async function openNodeMenu(node: WorkspaceFileTreeNode) {
      const row = renderTreeRowElement(node);
      return openRowMenu(row);
    }

    async function clickExact(name: string) {
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: (accessibleName) => accessibleName === name,
        }),
      );
    }

    function expectPasteDisabled() {
      const paste = screen.getByRole("menuitem", {
        name: (accessibleName) => accessibleName === "Paste",
      });
      expect(
        paste.getAttribute("aria-disabled") === "true" ||
          paste.hasAttribute("data-disabled"),
      ).toBe(true);
    }

    it("orders a Chinese macOS folder menu and keeps paste disabled until a path is copied", async () => {
      const previousPlatform = navigator.platform;
      setNavigatorPlatform("MacIntel");
      try {
        const onTransferEntry = vi.fn(async () => undefined);
        renderEditable(clipboardTree, { locale: "zh", onTransferEntry });
        const items = await openNodeMenu(srcDir);
        expect(items.map((item) => item.textContent)).toEqual([
          "新建文件",
          "新建文件夹",
          "在 Finder 中打开",
          "复制文件名",
          "复制相对路径",
          "复制绝对路径",
          "剪切",
          "复制",
          "粘贴",
          "重命名",
          "删除",
        ]);
        expect(
          document.querySelectorAll('[data-slot="context-menu-separator"]'),
        ).toHaveLength(3);
        const paste = screen.getByRole("menuitem", { name: "粘贴" });
        expect(
          paste.getAttribute("aria-disabled") === "true" ||
            paste.hasAttribute("data-disabled"),
        ).toBe(true);
        fireEvent.click(paste);
        expect(onTransferEntry).not.toHaveBeenCalled();
      } finally {
        setNavigatorPlatform(previousPlatform);
      }
    });

    it("orders a Chinese macOS file menu without New Folder", async () => {
      const previousPlatform = navigator.platform;
      setNavigatorPlatform("MacIntel");
      try {
        renderEditable(clipboardTree, { locale: "zh" });
        const items = await openNodeMenu(appFile);
        expect(items.map((item) => item.textContent)).toEqual([
          "新建文件",
          "在 Finder 中打开",
          "复制文件名",
          "复制相对路径",
          "复制绝对路径",
          "剪切",
          "复制",
          "粘贴",
          "重命名",
          "删除",
        ]);
        expect(
          screen.queryByRole("menuitem", { name: "新建文件夹" }),
        ).toBeNull();
        expect(
          document.querySelectorAll('[data-slot="context-menu-separator"]'),
        ).toHaveLength(3);
      } finally {
        setNavigatorPlatform(previousPlatform);
      }
    });

    it("orders an English folder menu without Finder when the platform is not macOS", async () => {
      renderEditable(clipboardTree);
      const items = await openNodeMenu(srcDir);
      expect(items.map((item) => item.textContent)).toEqual([
        "New File",
        "New Folder",
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
        "Cut",
        "Copy",
        "Paste",
        "Rename",
        "Delete",
      ]);
      expect(
        document.querySelectorAll('[data-slot="context-menu-separator"]'),
      ).toHaveLength(3);
    });

    it("does not arm paste when copying the file name, then copies into the clicked folder", async () => {
      const onOpenFile = vi.fn();
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onOpenFile, onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Copy file name");
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("app.tsx");
      });

      await openNodeMenu(appFile);
      expectPasteDisabled();

      await openNodeMenu(appFile);
      await clickExact("Copy");
      await openNodeMenu(rootComponents);
      await clickExact("Paste");

      expect(onTransferEntry).toHaveBeenCalledWith({
        destinationDirectory: "components",
        destinationPath: "components/app.tsx",
        operation: "copy",
        sourceDirectory: "src",
        sourcePath: "src/app.tsx",
      });
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(findDraftNode(latestTreeData())).toBeNull();
    });

    it("adds a copy suffix when pasting into the source directory", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(
        [
          {
            ...srcDir,
            children: [
              appFile,
              {
                ...appFile,
                id: "src/app 副本.tsx",
                name: "app 副本.tsx",
                path: "src/app 副本.tsx",
              },
              mainFile,
            ],
          },
          gitignore,
          appTest,
          rootComponents,
        ],
        { onTransferEntry },
      );

      await openNodeMenu(appFile);
      await clickExact("Copy");
      await openNodeMenu(mainFile);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenLastCalledWith(
        expect.objectContaining({ destinationPath: "src/app 副本 2.tsx" }),
      );

      await openNodeMenu(gitignore);
      await clickExact("Copy");
      await openNodeMenu(appTest);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenLastCalledWith(
        expect.objectContaining({ destinationPath: ".gitignore 副本" }),
      );

      await openNodeMenu(appTest);
      await clickExact("Copy");
      await openNodeMenu(gitignore);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenLastCalledWith(
        expect.objectContaining({ destinationPath: "app.test 副本.tsx" }),
      );

      await openNodeMenu(rootComponents);
      await clickExact("Copy");
      await openNodeMenu(gitignore);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenLastCalledWith(
        expect.objectContaining({
          destinationPath: "components 副本",
          operation: "copy",
        }),
      );
    });

    it("reports an existing target when a copied file is pasted twice into another folder", async () => {
      const onTransferEntry = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce({
          code: "AGENT_SESSION_VALIDATION_FAILED",
          message: "Target already exists.",
          reason: "pathAlreadyExists",
        });
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Copy");
      await openNodeMenu(rootComponents);
      await clickExact("Paste");
      await openNodeMenu(rootComponents);
      const paste = await screen.findByRole("menuitem", {
        name: (accessibleName) => accessibleName === "Paste",
      });
      expect(paste).not.toHaveAttribute("aria-disabled", "true");
      expect(paste).not.toHaveAttribute("data-disabled");
      fireEvent.click(paste);
      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith("Target already exists.");
      });
      expect(onTransferEntry).toHaveBeenCalledTimes(2);
      expect(findFileTreeNode(latestTreeData(), "src/app.tsx")).not.toBeNull();
    });

    it("copies a directory into another directory", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(nestedComponents);
      await clickExact("Copy");
      await openNodeMenu(libDir);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenCalledWith({
        destinationDirectory: "lib",
        destinationPath: "lib/components",
        operation: "copy",
        sourceDirectory: "src",
        sourcePath: "src/components",
      });
    });

    it("rejects pasting a folder into itself", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(nestedComponents);
      await clickExact("Copy");
      await openNodeMenu(nestedComponents);
      await clickExact("Paste");
      await openNodeMenu(buttonFile);
      await clickExact("Paste");
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Cannot paste a folder into itself.",
      );
      expect(onTransferEntry).not.toHaveBeenCalled();
    });

    it("moves a cut file, clears the clipboard, and leaves same-directory paste armed", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Cut");
      await openNodeMenu(srcDir);
      await clickExact("Paste");
      expect(onTransferEntry).not.toHaveBeenCalled();

      await openNodeMenu(mainFile);
      await clickExact("Paste");
      expect(onTransferEntry).not.toHaveBeenCalled();

      await openNodeMenu(rootComponents);
      await clickExact("Paste");
      expect(onTransferEntry).toHaveBeenCalledWith({
        destinationDirectory: "components",
        destinationPath: "components/app.tsx",
        operation: "move",
        sourceDirectory: "src",
        sourcePath: "src/app.tsx",
      });
      await openNodeMenu(rootComponents);
      expectPasteDisabled();
    });

    it("rejects moving a folder into its descendant and keeps paste available", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(nestedComponents);
      await clickExact("Cut");
      await openNodeMenu(uiDir);
      await clickExact("Paste");
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Cannot move a folder into itself.",
      );
      expect(onTransferEntry).not.toHaveBeenCalled();
      await openNodeMenu(uiDir);
      expect(
        screen.getByRole("menuitem", {
          name: (accessibleName) => accessibleName === "Paste",
        }),
      ).not.toHaveAttribute("data-disabled");
    });

    it("does not overwrite an existing file when a cut is pasted", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable([srcDir, occupiedComponents], { onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Cut");
      await openNodeMenu(occupiedComponents);
      await clickExact("Paste");
      expect(toastErrorMock).toHaveBeenCalledWith("Target already exists.");
      expect(onTransferEntry).not.toHaveBeenCalled();
      await openNodeMenu(occupiedComponents);
      expect(
        screen.getByRole("menuitem", {
          name: (accessibleName) => accessibleName === "Paste",
        }),
      ).not.toHaveAttribute("data-disabled");
    });

    it("disables paste when the workspace root no longer matches the clipboard", async () => {
      const view = renderEditable([{ ...appFile, id: "a.ts", path: "a.ts" }], {
        workspacePath: "/repo-a",
      });
      await openNodeMenu({ ...appFile, id: "a.ts", path: "a.ts" });
      await clickExact("Copy");
      view.rerender(
        <I18nProvider fixedLocale="en">
          <FileTreePanel
            errorMessage={null}
            fileTree={[{ ...appFile, id: "a.ts", path: "a.ts" }]}
            isLoading={false}
            workspacePath="/repo-b"
            onCreateEntry={vi.fn(async () => undefined)}
            onDeleteEntry={vi.fn()}
            onOpenFile={() => {}}
          />
        </I18nProvider>,
      );
      await openNodeMenu({ ...appFile, id: "a.ts", path: "a.ts" });
      expectPasteDisabled();
      view.rerender(
        <I18nProvider fixedLocale="en">
          <FileTreePanel
            errorMessage={null}
            fileTree={[{ ...appFile, id: "a.ts", path: "a.ts" }]}
            isLoading={false}
            workspacePath="/repo-a"
            onCreateEntry={vi.fn(async () => undefined)}
            onDeleteEntry={vi.fn()}
            onOpenFile={() => {}}
          />
        </I18nProvider>,
      );
      await openNodeMenu({ ...appFile, id: "a.ts", path: "a.ts" });
      expect(
        screen.getByRole("menuitem", {
          name: (accessibleName) => accessibleName === "Paste",
        }),
      ).not.toHaveAttribute("data-disabled");
    });

    it("renames the current row in place and cancels an unchanged or blank name", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Rename");
      expect(findDraftNode(latestTreeData())).toBeNull();
      const input = within(renderTreeRowElement(appFile)).getByRole("textbox", {
        name: "Rename",
      });
      expect(input).toHaveValue("app.tsx");

      fireEvent.keyDown(input, { key: "Enter" });
      expect(onTransferEntry).not.toHaveBeenCalled();
      expect(
        within(renderTreeRowElement(appFile)).queryByRole("textbox"),
      ).toBeNull();

      await openNodeMenu(appFile);
      await clickExact("Rename");
      const blank = within(renderTreeRowElement(appFile)).getByRole("textbox", {
        name: "Rename",
      });
      fireEvent.change(blank, { target: { value: "   " } });
      fireEvent.keyDown(blank, { key: "Enter" });
      expect(onTransferEntry).not.toHaveBeenCalled();

      await openNodeMenu(appFile);
      await clickExact("Rename");
      const next = within(renderTreeRowElement(appFile)).getByRole("textbox", {
        name: "Rename",
      });
      fireEvent.change(next, { target: { value: "main.tsx" } });
      fireEvent.keyDown(next, { key: "Enter" });
      await waitFor(() => {
        expect(onTransferEntry).toHaveBeenCalledWith({
          destinationDirectory: "src",
          destinationPath: "src/main.tsx",
          operation: "move",
          sourceDirectory: "src",
          sourcePath: "src/app.tsx",
        });
      });
    });

    it("keeps the rename input for an invalid or existing name", async () => {
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, { onTransferEntry });
      await openNodeMenu(appFile);
      await clickExact("Rename");
      const input = within(renderTreeRowElement(appFile)).getByRole("textbox", {
        name: "Rename",
      });
      fireEvent.change(input, { target: { value: "a/b" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Name is invalid. It cannot contain / or be . or ..",
        );
      });
      expect(
        within(renderTreeRowElement(appFile)).getByRole("textbox", {
          name: "Rename",
        }),
      ).toHaveAttribute("aria-invalid", "true");
      expect(onTransferEntry).not.toHaveBeenCalled();

      const again = within(renderTreeRowElement(appFile)).getByRole("textbox", {
        name: "Rename",
      });
      fireEvent.change(again, { target: { value: "main.ts" } });
      fireEvent.keyDown(again, { key: "Enter" });
      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith("Target already exists.");
      });
      expect(onTransferEntry).not.toHaveBeenCalled();
      expect(findFileTreeNode(latestTreeData(), "src/app.tsx")).not.toBeNull();
    });

    it("rebases expanded directories when a directory is renamed", async () => {
      const onOpenStateChange = vi.fn();
      const onTransferEntry = vi.fn(async () => undefined);
      renderEditable(clipboardTree, {
        initialOpenState: { src: true, "src/components": true },
        onOpenStateChange,
        onTransferEntry,
      });
      await openNodeMenu(srcDir);
      await clickExact("Rename");
      const input = within(renderTreeRowElement(srcDir)).getByRole("textbox", {
        name: "Rename",
      });
      fireEvent.change(input, { target: { value: "library" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => {
        expect(onTransferEntry).toHaveBeenCalledWith(
          expect.objectContaining({
            destinationPath: "library",
            sourcePath: "src",
          }),
        );
      });
      expect(onOpenStateChange).toHaveBeenLastCalledWith({
        library: true,
        "library/components": true,
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
  return renderTreeRowElement(menuTargetFileNode);
}

function renderWithI18n(component: ReactNode) {
  return render(<I18nProvider fixedLocale="en">{component}</I18nProvider>);
}

function setNavigatorPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
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

  return renderTreeRowElement(nodeData);
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

  return renderTreeRowElement(nodeData);
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

/** 渲染带新建与删除能力的面板（对齐代码页的真实注入组合）。 */
function renderDeletePanel(
  onDeleteEntry: (input: FileTreeEntryDeleteInput) => void,
): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <FileTreePanel
      errorMessage={null}
      fileTree={sampleTree}
      isLoading={false}
      onOpenFile={() => {}}
      workspacePath="/repo"
      onCreateEntry={vi.fn()}
      onDeleteEntry={onDeleteEntry}
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
  const { container } = render(
    <FileTreeRowModelContext.Provider value={readFileTreeRowModel()}>
      {createElement(renderer, {
        node: {
          data: nodeData,
          level,
          isOpen: false,
          toggle: () => {},
        },
        style: {},
      } as NodeRendererProps<WorkspaceFileTreeNode>)}
    </FileTreeRowModelContext.Provider>,
  );
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
