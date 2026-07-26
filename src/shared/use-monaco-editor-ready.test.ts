import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configureMonacoEditorMock = vi.hoisted(() => vi.fn());

vi.mock("./monaco-editor-setup", () => ({
  configureMonacoEditor: configureMonacoEditorMock,
}));

describe("useMonacoEditorReady", () => {
  beforeEach(() => {
    configureMonacoEditorMock.mockReset();
  });

  it("configures monaco on demand and reports ready", async () => {
    const { useMonacoEditorReady } = await import("./use-monaco-editor-ready");
    const { result } = renderHook(() => useMonacoEditorReady());

    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(configureMonacoEditorMock).toHaveBeenCalledTimes(1);
  });
});
