import { afterEach, describe, expect, it, vi } from "vitest";

const loaderConfigMock = vi.hoisted(() => vi.fn());
const typescriptDefaultsSetDiagnosticsMock = vi.hoisted(() => vi.fn());
const javascriptDefaultsSetDiagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock("@monaco-editor/react", () => ({
  loader: {
    config: loaderConfigMock,
  },
}));

vi.mock("monaco-editor", () => ({
  editor: {},
  languages: {},
  typescript: {
    typescriptDefaults: {
      setDiagnosticsOptions: typescriptDefaultsSetDiagnosticsMock,
    },
    javascriptDefaults: {
      setDiagnosticsOptions: javascriptDefaultsSetDiagnosticsMock,
    },
  },
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
    typescriptDefaultsSetDiagnosticsMock.mockClear();
    javascriptDefaultsSetDiagnosticsMock.mockClear();
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
      monaco: expect.objectContaining({
        editor: {},
        typescript: expect.any(Object),
      }),
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

  it("disables semantic diagnostics for read-only viewers", async () => {
    const { configureMonacoEditor } = await import("./monaco-editor-setup");

    configureMonacoEditor();

    // 只读查看场景关闭 TS/JS 语义诊断，避免 tsx 因默认未设 jsx 导致的 unused import 误报。
    expect(typescriptDefaultsSetDiagnosticsMock).toHaveBeenCalledWith({
      noSemanticValidation: true,
    });
    expect(javascriptDefaultsSetDiagnosticsMock).toHaveBeenCalledWith({
      noSemanticValidation: true,
    });
  });
});
