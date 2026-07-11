import { describe, expect, it } from "vitest";

import {
  CONTENT_FONT_SIZE_OPTIONS,
  DEFAULT_CONTENT_FONT_SIZE,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
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
