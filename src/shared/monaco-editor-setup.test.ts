import { afterEach, describe, expect, it, vi } from "vitest";

const loaderConfigMock = vi.hoisted(() => vi.fn());
const typescriptDefaultsSetDiagnosticsMock = vi.hoisted(() => vi.fn());
const javascriptDefaultsSetDiagnosticsMock = vi.hoisted(() => vi.fn());
const languagesGetLanguagesMock = vi.hoisted(() => vi.fn(() => []));
const languagesRegisterMock = vi.hoisted(() => vi.fn());
const languagesSetMonarchTokensProviderMock = vi.hoisted(() => vi.fn());

vi.mock("@monaco-editor/react", () => ({
  loader: {
    config: loaderConfigMock,
  },
}));

vi.mock("monaco-editor", () => ({
  editor: {},
  languages: {
    getLanguages: languagesGetLanguagesMock,
    register: languagesRegisterMock,
    setMonarchTokensProvider: languagesSetMonarchTokensProviderMock,
  },
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
    languagesGetLanguagesMock.mockClear();
    languagesRegisterMock.mockClear();
    languagesSetMonarchTokensProviderMock.mockClear();
    languagesGetLanguagesMock.mockReturnValue([]);
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

  it("disables semantic and syntax diagnostics for non-IDE viewers", async () => {
    const { configureMonacoEditor } = await import("./monaco-editor-setup");

    configureMonacoEditor();

    // 无项目 TS 语言服务时诊断易误报；关闭语义与语法诊断，仅保留高亮。
    expect(typescriptDefaultsSetDiagnosticsMock).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    expect(javascriptDefaultsSetDiagnosticsMock).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  });

  it("registers prisma language for schema highlighting", async () => {
    const { configureMonacoEditor } = await import("./monaco-editor-setup");

    configureMonacoEditor();

    expect(languagesRegisterMock).toHaveBeenCalledWith({
      id: "prisma",
      extensions: [".prisma"],
      aliases: ["Prisma", "prisma"],
    });
    expect(languagesSetMonarchTokensProviderMock).toHaveBeenCalledWith(
      "prisma",
      expect.objectContaining({
        tokenizer: expect.any(Object),
      }),
    );
  });
});
