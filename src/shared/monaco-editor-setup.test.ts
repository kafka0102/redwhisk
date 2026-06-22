import { afterEach, describe, expect, it, vi } from "vitest";

const loaderConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@monaco-editor/react", () => ({
  loader: {
    config: loaderConfigMock,
  },
}));

vi.mock("monaco-editor", () => ({
  editor: {},
  languages: {},
}));

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class EditorWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({
  default: class CssWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({
  default: class HtmlWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({
  default: class JsonWorker {},
}));

vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({
  default: class TsWorker {},
}));

describe("configureMonacoEditor", () => {
  afterEach(() => {
    loaderConfigMock.mockClear();
    delete (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment;
    vi.resetModules();
  });

  it("configures Monaco with local workers once", async () => {
    const { configureMonacoEditor } = await import("./monaco-editor-setup");

    configureMonacoEditor();
    configureMonacoEditor();

    const environment = (
      globalThis as {
        MonacoEnvironment?: {
          getWorker: (_workerId: string, label: string) => Worker;
        };
      }
    ).MonacoEnvironment;

    expect(loaderConfigMock).toHaveBeenCalledTimes(1);
    expect(loaderConfigMock).toHaveBeenCalledWith({
      monaco: expect.objectContaining({ editor: {}, languages: {} }),
    });
    expect(environment?.getWorker("1", "typescript").constructor.name).toBe(
      "TsWorker",
    );
    expect(environment?.getWorker("1", "css").constructor.name).toBe(
      "CssWorker",
    );
    expect(environment?.getWorker("1", "json").constructor.name).toBe(
      "JsonWorker",
    );
    expect(environment?.getWorker("1", "html").constructor.name).toBe(
      "HtmlWorker",
    );
    expect(environment?.getWorker("1", "plaintext").constructor.name).toBe(
      "EditorWorker",
    );
  });
});
