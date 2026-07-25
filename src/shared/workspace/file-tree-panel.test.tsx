import type { ReactElement, ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRendererProps } from "react-arborist";

import { I18nProvider } from "../i18n/i18n";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";
import { FileTreePanel, FileTreeStatusBadge } from "./file-tree-panel";

type FileTreeRowRenderer = (
  props: NodeRendererProps<WorkspaceFileTreeNode>,
) => ReactNode;

const treeHeights: number[] = [];
const treeRowRenderers: FileTreeRowRenderer[] = [];

vi.mock("react-arborist", () => ({
  Tree: ({
    children,
    height,
    "aria-label": ariaLabel,
  }: {
    children?: FileTreeRowRenderer;
    height: number;
    "aria-label"?: string;
  }) => {
    treeHeights.push(height);
    if (children) {
      treeRowRenderers.push(children);
    }
    return (
      <div
        aria-label={ariaLabel}
        data-testid="mock-file-tree"
        data-height={height}
      />
    );
  },
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
});

function renderWithI18n(component: ReactNode) {
  return render(<I18nProvider fixedLocale="en">{component}</I18nProvider>);
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
