import { beforeEach, describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES, LOCALE_STORAGE_KEY } from "./i18n-constants";
import i18n, { changeLocale, getDefaultLocale } from "./i18n-instance";

describe("getDefaultLocale", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to zh when nothing is stored", () => {
    expect(getDefaultLocale()).toBe("zh");
  });

  it("returns a stored supported locale", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(getDefaultLocale()).toBe("en");
  });

  it("falls back to zh for unsupported stored values", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(getDefaultLocale()).toBe("zh");
  });

  it("only supports zh and en", () => {
    expect(SUPPORTED_LOCALES).toContain(getDefaultLocale());
  });
});

describe("changeLocale", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches the active language and persists it", async () => {
    await changeLocale("en");
    expect(i18n.language).toBe("en");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("interpolates placeholders via t", async () => {
    await changeLocale("zh");
    expect(i18n.t("app.workbench", { projectName: "RedWhisk" })).toContain(
      "RedWhisk",
    );
  });
});
