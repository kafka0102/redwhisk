import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "./clipboard-commands";
import { copyTextToClipboard } from "./copy-text-to-clipboard";

vi.mock("./clipboard-commands", () => ({
  writeClipboardText: vi.fn(),
}));

const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe("copyTextToClipboard", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeClipboardTextMock.mockReset();
    writeTextMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it("优先走原生剪贴板，跳过 WebView 兜底", async () => {
    writeClipboardTextMock.mockResolvedValue(undefined);

    await expect(copyTextToClipboard("a.ts")).resolves.toBe(true);

    expect(writeClipboardTextMock).toHaveBeenCalledWith("a.ts");
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("原生写入失败时回退 WebView 剪贴板", async () => {
    writeClipboardTextMock.mockRejectedValue(new Error("unavailable"));
    writeTextMock.mockResolvedValue(undefined);

    await expect(copyTextToClipboard("a.ts")).resolves.toBe(true);

    expect(writeTextMock).toHaveBeenCalledWith("a.ts");
  });

  it("两条路径都失败时返回 false", async () => {
    writeClipboardTextMock.mockRejectedValue(new Error("unavailable"));
    writeTextMock.mockRejectedValue(new Error("denied"));

    await expect(copyTextToClipboard("a.ts")).resolves.toBe(false);
  });

  it("原生失败且 WebView 无剪贴板时返回 false", async () => {
    writeClipboardTextMock.mockRejectedValue(new Error("unavailable"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    await expect(copyTextToClipboard("a.ts")).resolves.toBe(false);
  });
});
