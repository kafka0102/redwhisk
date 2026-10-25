import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/i18n";
import { toast } from "../toast";
import {
  WorkspacePathContextMenu,
  type WorkspacePathContextMenuTarget,
} from "./workspace-path-context-menu";

const revealItemInDir = vi.hoisted(() => vi.fn());
const openPath = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
  revealItemInDir,
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

// Base UI 只在非 macOS 平台吞掉「打开手势」的右键释放（useMenuItemCommonProps
// 按 detectBrowser.isMac 分支）。jsdom 默认平台不是 mac，这里伪装成 macOS，
// 才覆盖得到本应用真实运行的平台路径。
vi.hoisted(() => {
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(globalThis.navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

const toastSuccessMock = vi.mocked(toast.success);

function Harness(): ReactElement {
  const [target, setTarget] = useState<{
    displayName: string;
    relativePath: string;
    x: number;
    y: number;
  } | null>(null);

  return (
    <I18nProvider fixedLocale="en">
      <button
        type="button"
        data-testid="file-row"
        onContextMenu={(event) => {
          event.preventDefault();
          setTarget({
            displayName: "a.ts",
            relativePath: "src/a.ts",
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        a.ts
      </button>
      <WorkspacePathContextMenu
        target={target}
        workspacePath="/repo"
        onClose={() => setTarget(null)}
      />
    </I18nProvider>
  );
}

function openFileRowMenu(clientX: number, clientY: number): HTMLElement {
  const row = screen.getByTestId("file-row");
  fireEvent.pointerDown(row, {
    button: 2,
    clientX,
    clientY,
    pointerType: "mouse",
  });
  fireEvent.mouseDown(row, { button: 2, clientX, clientY });
  fireEvent.contextMenu(row, { clientX, clientY });
  return row;
}

describe("WorkspacePathContextMenu", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    toastSuccessMock.mockReset();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    revealItemInDir.mockReset();
    openPath.mockReset();
    revealItemInDir.mockResolvedValue(undefined);
    openPath.mockResolvedValue(undefined);
    setNavigatorPlatform("MacIntel");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it("keeps copy file name clickable after the pointer leaves a bottom-of-window menu", async () => {
    render(<Harness />);
    openFileRowMenu(40, 580);

    const item = await screen.findByRole("menuitem", {
      name: "Copy file name",
    });
    const popup = item.closest("[data-slot='context-menu-content']");
    expect(popup).toBeInstanceOf(HTMLElement);
    fireEvent.mouseLeave(popup as HTMLElement);
    fireEvent.mouseLeave(popup?.parentElement as HTMLElement);

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    fireEvent.click(item);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("a.ts");
    });
  });

  it("keeps copy file name clickable after leftover right-press lands on the backdrop", async () => {
    render(<Harness />);
    const row = openFileRowMenu(40, 580);
    const item = await screen.findByRole("menuitem", {
      name: "Copy file name",
    });

    fireEvent.pointerUp(row, {
      button: 2,
      clientX: 40,
      clientY: 580,
      pointerType: "mouse",
    });
    const backdrop = document.querySelector("[data-base-ui-inert]");
    expect(backdrop).toBeInstanceOf(HTMLElement);
    fireEvent.pointerDown(backdrop as HTMLElement, {
      button: 2,
      clientX: 40,
      clientY: 580,
      pointerType: "mouse",
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    fireEvent.click(item);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("a.ts");
    });
  });

  it("ignores the right-button mouseup that belongs to the opening gesture", async () => {
    render(<Harness />);
    const row = openFileRowMenu(40, 580);
    const item = await screen.findByRole("menuitem", {
      name: "Copy file name",
    });

    // 菜单压住光标后，打开菜单那次右键的 mouseup 会落在菜单项上。它属于打开
    // 手势，不能被当成「在菜单项上松开右键」而触发复制并关掉菜单。
    fireEvent.pointerUp(row, {
      button: 2,
      clientX: 40,
      clientY: 580,
      pointerType: "mouse",
    });
    fireEvent.mouseUp(item, { button: 2, clientX: 40, clientY: 580 });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    expect(writeTextMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menuitem", { name: "Copy file name" }),
    ).toBeInTheDocument();

    fireEvent.click(item);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("a.ts");
    });
  });

  it("shows Open in Finder after the copy actions and reveals the file", async () => {
    revealItemInDir.mockReset();
    openPath.mockReset();
    revealItemInDir.mockResolvedValue(undefined);
    openPath.mockResolvedValue(undefined);

    render(<Harness />);
    openFileRowMenu(40, 80);

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Copy file name",
      "Copy relative path",
      "Copy absolute path",
      "Open in Finder",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Finder" }));

    await waitFor(() => {
      expect(revealItemInDir).toHaveBeenCalledWith("/repo/src/a.ts");
    });
    expect(openPath).not.toHaveBeenCalledWith("/repo/src");
  });

  it("opens a directory itself instead of revealing it in the parent", async () => {
    renderFinderMenu({
      displayName: "src",
      kind: "directory",
      relativePath: "src",
    });
    openFileRowMenu(40, 80);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open in Finder" }),
    );

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith("/repo/src");
    });
    expect(revealItemInDir).not.toHaveBeenCalled();
  });

  it("reveals a workspace-root file in Finder", async () => {
    renderFinderMenu({
      displayName: "README.md",
      relativePath: "README.md",
    });
    openFileRowMenu(40, 80);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open in Finder" }),
    );

    await waitFor(() => {
      expect(revealItemInDir).toHaveBeenCalledWith("/repo/README.md");
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["empty", ""],
  ] as const)(
    "hides Open in Finder and absolute copy when the workspace root is %s",
    async (_label, workspacePath) => {
      renderFinderMenu({ workspacePath });
      openFileRowMenu(40, 80);

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Copy file name",
        "Copy relative path",
      ]);
      expect(
        screen.queryByRole("menuitem", { name: "Open in Finder" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("menuitem", { name: "Copy absolute path" }),
      ).not.toBeInTheDocument();
    },
  );

  it("hides Open in Finder when the relative path is empty", async () => {
    renderFinderMenu({ relativePath: "" });
    openFileRowMenu(40, 80);

    expect(
      await screen.findByRole("menuitem", { name: "Copy absolute path" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Open in Finder" }),
    ).not.toBeInTheDocument();
  });

  it.each(["Win32", "Linux x86_64"])(
    "hides Open in Finder on %s",
    async (platform) => {
      setNavigatorPlatform(platform);
      renderFinderMenu();
      openFileRowMenu(40, 80);

      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Copy file name",
        "Copy relative path",
        "Copy absolute path",
      ]);
      expect(
        screen.queryByRole("menuitem", { name: "Open in Finder" }),
      ).not.toBeInTheDocument();
    },
  );

  it("places Open in Finder after the copy actions and before delete", async () => {
    renderFinderMenu({ withCreateAndDelete: true });
    openFileRowMenu(40, 80);

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "New File",
      "New Folder",
      "Copy file name",
      "Copy relative path",
      "Copy absolute path",
      "Open in Finder",
      "Delete",
    ]);
  });

  it("shows the Finder failure alert instead of the browser failure", async () => {
    revealItemInDir.mockRejectedValue(new Error("denied"));
    renderFinderMenu();
    openFileRowMenu(40, 80);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open in Finder" }),
    );

    expect(
      await screen.findByText("Could not open this item in Finder."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Could not open this file in the browser."),
    ).not.toBeInTheDocument();
  });

  it("labels the action 在 Finder 中打开 in Chinese", async () => {
    renderFinderMenu({ locale: "zh" });
    openFileRowMenu(40, 80);

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "复制文件名",
      "复制相对路径",
      "复制绝对路径",
      "在 Finder 中打开",
    ]);
  });
});

function renderFinderMenu(
  options: {
    displayName?: string;
    kind?: WorkspacePathContextMenuTarget["kind"];
    locale?: "en" | "zh";
    relativePath?: string;
    withCreateAndDelete?: boolean;
    workspacePath?: string | null;
  } = {},
): void {
  const displayName = options.displayName ?? "a.ts";
  const relativePath = options.relativePath ?? "src/a.ts";
  const workspacePath =
    options.workspacePath === undefined ? "/repo" : options.workspacePath;

  function FinderMenuHarness(): ReactElement {
    const [target, setTarget] = useState<WorkspacePathContextMenuTarget | null>(
      null,
    );

    return (
      <I18nProvider fixedLocale={options.locale ?? "en"}>
        <button
          type="button"
          data-testid="file-row"
          onContextMenu={(event) => {
            event.preventDefault();
            setTarget({
              displayName,
              kind: options.kind,
              relativePath,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          {displayName}
        </button>
        <WorkspacePathContextMenu
          createActions={
            options.withCreateAndDelete
              ? {
                  onCreateDirectory: () => {},
                  onCreateFile: () => {},
                }
              : null
          }
          deleteAction={
            options.withCreateAndDelete ? { onDelete: () => {} } : null
          }
          target={target}
          workspacePath={workspacePath}
          onClose={() => setTarget(null)}
        />
      </I18nProvider>
    );
  }

  render(<FinderMenuHarness />);
}

function setNavigatorPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}
