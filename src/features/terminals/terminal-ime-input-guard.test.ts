import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTerminalImeInputGuard } from "./terminal-ime-input-guard";

function createHarness(): {
  host: HTMLDivElement;
  textarea: HTMLTextAreaElement;
} {
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  host.appendChild(textarea);
  document.body.appendChild(host);
  return { host, textarea };
}

describe("installTerminalImeInputGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("clears residual text before keyCode 229 reaches xterm handlers", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);
    textarea.value = "你好";

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Process",
        keyCode: 229,
        bubbles: true,
      }),
    );

    expect(textarea.value).toBe("");
    guard.dispose();
  });

  it("does not clear residual while composing", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    textarea.value = "ni";
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Process",
        keyCode: 229,
        bubbles: true,
      }),
    );

    expect(textarea.value).toBe("ni");
    guard.dispose();
  });

  it("clears residual after composition finalizer finishes", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    textarea.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    textarea.value = "你";
    textarea.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(textarea.value).toBe("你");

    vi.runAllTimers();
    expect(textarea.value).toBe("");

    guard.dispose();
  });

  it("swallows Backspace that only clears helper residual", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);
    textarea.value = "残留";

    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      keyCode: 8,
      bubbles: true,
      cancelable: true,
    });
    const stopSpy = vi.spyOn(event, "stopPropagation");
    textarea.dispatchEvent(event);

    expect(textarea.value).toBe("");
    expect(event.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(guard.shouldForwardData("\x7f")).toBe(false);

    guard.dispose();
  });

  it("forwards DEL only after a real Backspace keydown on empty textarea", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    expect(guard.shouldForwardData("\x7f")).toBe(false);

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        bubbles: true,
      }),
    );
    expect(guard.shouldForwardData("\x7f")).toBe(true);
    expect(guard.shouldForwardData("\x7f")).toBe(false);

    guard.dispose();
  });

  it("forwards normal data unchanged", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    expect(guard.shouldForwardData("a")).toBe(true);
    expect(guard.shouldForwardData("中")).toBe(true);
    expect(guard.shouldForwardData("，")).toBe(true);
    expect(guard.shouldForwardData("\r")).toBe(true);

    guard.dispose();
  });
});
