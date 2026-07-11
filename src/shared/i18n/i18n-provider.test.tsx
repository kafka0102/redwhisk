import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider, useI18n } from "./i18n-provider";

function Probe() {
  const { t, locale, themePreference, contentFontSize } = useI18n();
  return (
    <span data-testid="probe">
      {t("globalSettings.language")}|{locale}|{themePreference}|
      {contentFontSize}
    </span>
  );
}

describe("I18nProvider", () => {
  it("exposes t and honors an explicit zh locale", () => {
    render(
      <I18nProvider initialLocale="zh">
        <Probe />
      </I18nProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("语言");
    expect(text).toContain("zh");
    expect(text).toContain("light");
  });

  it("defaults to en when no locale is provided", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("Language");
    expect(text).toContain("en");
  });

  it("returns an English fallback when used without a provider", () => {
    function NoProvider() {
      const { t, locale } = useI18n();
      return (
        <span data-testid="bare">
          {t("globalSettings.language")}|{locale}
        </span>
      );
    }
    render(<NoProvider />);
    const text = screen.getByTestId("bare").textContent ?? "";
    // 全局默认 en，裸渲染不崩溃且走英文
    expect(text).toContain("Language");
    expect(text).toContain("en");
  });
});
