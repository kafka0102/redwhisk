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
    textarea.value = "nihao";
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Process",
        keyCode: 229,
        bubbles: true,
      }),
    );
    expect(textarea.value).toBe("nihao");
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

  it("drops DEL during IME key suppress window even after empty-textarea Backspace", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Process",
        keyCode: 229,
        bubbles: true,
      }),
    );
    // IME 随后可能再打一个“空 textarea 的 Backspace”
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(guard.filterData("\x7f")).toBeNull();
    expect(guard.filterData("，")).toBe("，");
    expect(guard.filterData("，\x7f")).toBe("，");

    vi.advanceTimersByTime(50);
    // suppress 结束后，真实 Backspace 才可转发
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        bubbles: true,
      }),
    );
    expect(guard.filterData("\x7f")).toBe("\x7f");

    guard.dispose();
  });

  it("forwards DEL only after a real Backspace keydown on empty textarea", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    expect(guard.filterData("\x7f")).toBeNull();

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        bubbles: true,
      }),
    );
    expect(guard.filterData("\x7f")).toBe("\x7f");
    expect(guard.filterData("\x7f")).toBeNull();

    guard.dispose();
  });

  it("forwards normal data unchanged", () => {
    const { host, textarea } = createHarness();
    const guard = installTerminalImeInputGuard(host, textarea);

    expect(guard.filterData("a")).toBe("a");
    expect(guard.filterData("中")).toBe("中");
    expect(guard.filterData("，")).toBe("，");
    expect(guard.filterData("\r")).toBe("\r");

    guard.dispose();
  });
});
