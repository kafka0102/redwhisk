import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerPrismaLanguage", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("registers language and monarch tokens once", async () => {
    const { registerPrismaLanguage } = await import("./monaco-prisma-language");
    const getLanguages = vi.fn(() => [] as Array<{ id: string }>);
    const register = vi.fn();
    const setMonarchTokensProvider = vi.fn();
    const monacoApi = {
      languages: {
        getLanguages,
        register,
        setMonarchTokensProvider,
      },
    } as unknown as typeof import("monaco-editor");

    registerPrismaLanguage(monacoApi);
    registerPrismaLanguage(monacoApi);

    expect(register).toHaveBeenCalledTimes(1);
    expect(setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      id: "prisma",
      aliases: ["Prisma", "prisma"],
      extensions: [".prisma"],
    });
  });

  it("skips registration when prisma already exists", async () => {
    const { registerPrismaLanguage } = await import("./monaco-prisma-language");
    const register = vi.fn();
    const setMonarchTokensProvider = vi.fn();
    const monacoApi = {
      languages: {
        getLanguages: () => [{ id: "prisma" }],
        register,
        setMonarchTokensProvider,
      },
    } as unknown as typeof import("monaco-editor");

    registerPrismaLanguage(monacoApi);

    expect(register).not.toHaveBeenCalled();
    expect(setMonarchTokensProvider).not.toHaveBeenCalled();
  });
});
