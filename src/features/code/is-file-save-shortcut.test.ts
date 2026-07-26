import { afterEach, describe, expect, it, vi } from "vitest";

import { isFileSaveShortcut } from "./is-file-save-shortcut";

function keyEvent(init: KeyboardEventInit & { type?: string }): KeyboardEvent {
  const { type = "keydown", ...rest } = init;
  return new KeyboardEvent(type, rest);
}

describe("isFileSaveShortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches Cmd+S on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isFileSaveShortcut(keyEvent({ key: "s", metaKey: true }))).toBe(
      true,
    );
    expect(isFileSaveShortcut(keyEvent({ key: "S", metaKey: true }))).toBe(
      true,
    );
  });

  it("matches Ctrl+S on Windows/Linux", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(isFileSaveShortcut(keyEvent({ key: "s", ctrlKey: true }))).toBe(
      true,
    );

    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    expect(isFileSaveShortcut(keyEvent({ key: "S", ctrlKey: true }))).toBe(
      true,
    );
  });

  it("rejects wrong modifiers, alt, shift, or non-keydown", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isFileSaveShortcut(keyEvent({ key: "s", ctrlKey: true }))).toBe(
      false,
    );
    expect(
      isFileSaveShortcut(keyEvent({ key: "s", metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(
      isFileSaveShortcut(keyEvent({ key: "s", metaKey: true, altKey: true })),
    ).toBe(false);
    expect(
      isFileSaveShortcut(keyEvent({ type: "keyup", key: "s", metaKey: true })),
    ).toBe(false);
  });
});
