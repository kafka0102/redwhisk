import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import type { WorkspaceChangeKind } from "./workspace-commands";
import { FileTreePanel, FileTreeStatusBadge } from "./file-tree-panel";

const treeHeights: number[] = [];
const treeRowRenderers: ReactNode[] = [];

vi.mock("react-arborist", () => ({
  Tree: ({
    children,
    height,
    "aria-label": ariaLabel,
  }: {
    children?: ReactNode;
    height: number;
    "aria-label"?: string;
  }) => {
    treeHeights.push(height);
    treeRowRenderers.push(children);
    return (
      <div
        aria-label={ariaLabel}
        data-testid="mock-file-tree"
        data-height={height}
      />
    );
  },
}));

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
});

function renderWithI18n(component: ReactNode) {
  return render(<I18nProvider fixedLocale="en">{component}</I18nProvider>);
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
