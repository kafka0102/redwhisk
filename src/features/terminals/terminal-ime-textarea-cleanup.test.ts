import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTerminalImeTextareaCleanup } from "./terminal-ime-textarea-cleanup";

describe("installTerminalImeTextareaCleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears residual IME text after compositionend", () => {
    const textarea = document.createElement("textarea");
    const dispose = installTerminalImeTextareaCleanup(textarea);

    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.value = "你好";
    textarea.dispatchEvent(new Event("compositionend"));

    expect(textarea.value).toBe("你好");
    vi.runAllTimers();
    expect(textarea.value).toBe("");

    dispose();
  });

  it("does not clear while a new composition has started", () => {
    const textarea = document.createElement("textarea");
    const dispose = installTerminalImeTextareaCleanup(textarea);

    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.value = "你";
    textarea.dispatchEvent(new Event("compositionend"));
    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.value = "你好";

    vi.runAllTimers();
    expect(textarea.value).toBe("你好");

    dispose();
  });

  it("clears non-composition IME residue after input", () => {
    const textarea = document.createElement("textarea");
    const dispose = installTerminalImeTextareaCleanup(textarea);

    textarea.value = "，";
    textarea.dispatchEvent(new Event("input"));

    expect(textarea.value).toBe("，");
    vi.runAllTimers();
    expect(textarea.value).toBe("");

    dispose();
  });

  it("does not clear input events during composition", () => {
    const textarea = document.createElement("textarea");
    const dispose = installTerminalImeTextareaCleanup(textarea);

    textarea.dispatchEvent(new Event("compositionstart"));
    textarea.value = "ni";
    textarea.dispatchEvent(new Event("input"));
    vi.runAllTimers();
    expect(textarea.value).toBe("ni");

    dispose();
  });

  it("removes listeners on dispose", () => {
    const textarea = document.createElement("textarea");
    const dispose = installTerminalImeTextareaCleanup(textarea);

    dispose();
    textarea.value = "残留";
    textarea.dispatchEvent(new Event("compositionend"));
    vi.runAllTimers();
    expect(textarea.value).toBe("残留");
  });
});
