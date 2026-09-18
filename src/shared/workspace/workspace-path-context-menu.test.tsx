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
import { WorkspacePathContextMenu } from "./workspace-path-context-menu";

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
});
