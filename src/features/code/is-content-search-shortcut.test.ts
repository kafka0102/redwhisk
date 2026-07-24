import { afterEach, describe, expect, it, vi } from "vitest";

import { isContentSearchShortcut } from "./is-content-search-shortcut";

function keyEvent(init: KeyboardEventInit & { type?: string }): KeyboardEvent {
  const { type = "keydown", ...rest } = init;
  return new KeyboardEvent(type, rest);
}

describe("isContentSearchShortcut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches Cmd+Shift+F on macOS", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "F", metaKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("matches Ctrl+Shift+F on Windows/Linux", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "f", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);

    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "F", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("rejects the wrong modifier for the platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "f", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);

    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("rejects missing shift, wrong key, alt, or non-keydown", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isContentSearchShortcut(keyEvent({ key: "f", metaKey: true }))).toBe(
      false,
    );
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "g", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      isContentSearchShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true, altKey: true }),
      ),
    ).toBe(false);
    expect(
      isContentSearchShortcut(
        keyEvent({
          type: "keyup",
          key: "f",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });
});
