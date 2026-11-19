import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "./clipboard-commands";
import { invokeCommand } from "./command-client";

vi.mock("./command-client", () => ({
  invokeCommand: vi.fn(),
}));

const invokeCommandMock = vi.mocked(invokeCommand);

describe("writeClipboardText", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
  });

  it("writes text on the main-thread command", async () => {
    invokeCommandMock.mockResolvedValue(undefined);

    await writeClipboardText("a.ts");

    expect(invokeCommandMock).toHaveBeenCalledWith("write_clipboard_text", {
      text: "a.ts",
    });
  });

  it("rejects when the native write fails", async () => {
    invokeCommandMock.mockRejectedValue(new Error("clipboard"));

    await expect(writeClipboardText("a.ts")).rejects.toThrow("clipboard");
  });
});
