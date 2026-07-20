import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CONTENT_FONT_SIZE_OPTIONS,
  DEFAULT_CONTENT_FONT_SIZE,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  THEME_STORAGE_KEY,
  applyBootstrapDocumentTheme,
  getBootstrapDocumentTheme,
  resolveDocumentTheme,
} from "./i18n-constants";

describe("i18n constants", () => {
  it("defaults locale to zh", () => {
    expect(DEFAULT_LOCALE).toBe("zh");
  });

  it("supports zh and en only", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh", "en"]);
  });

  it("keeps the existing locale storage key", () => {
    expect(LOCALE_STORAGE_KEY).toBe("redwhisk.locale");
  });

  it("preserves content font size options and default", () => {
    expect(CONTENT_FONT_SIZE_OPTIONS).toEqual([13, 14, 15, 16, 18, 20, 22]);
    expect(DEFAULT_CONTENT_FONT_SIZE).toBe(14);
  });
});

describe("document theme bootstrap", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
  });

  it("resolves stored light/dark preference without consulting system", () => {
    expect(resolveDocumentTheme("dark", "light")).toBe("dark");
    expect(resolveDocumentTheme("light", "dark")).toBe("light");
  });

  it("resolves system preference from the system theme", () => {
    expect(resolveDocumentTheme("system", "dark")).toBe("dark");
    expect(resolveDocumentTheme("system", "light")).toBe("light");
  });

  it("reads the theme storage key and produces a document theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getBootstrapDocumentTheme()).toBe("dark");
  });

  it("uses system dark when preference is system", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    expect(getBootstrapDocumentTheme()).toBe("dark");
  });

  it("writes data-theme on the document element before React mounts", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const theme = applyBootstrapDocumentTheme();
    expect(theme).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("bootstraps theme from localStorage in index.html before the module entry", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const themeScriptIndex = html.indexOf("redwhisk.theme");
    const moduleEntryIndex = html.indexOf('src="/src/main.tsx"');
    expect(themeScriptIndex).toBeGreaterThan(-1);
    expect(moduleEntryIndex).toBeGreaterThan(-1);
    expect(themeScriptIndex).toBeLessThan(moduleEntryIndex);
    expect(html).toMatch(/document\.documentElement\.dataset\.theme\s*=/);
  });
});
