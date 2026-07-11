import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider, useI18n } from "./i18n-provider";

function Probe() {
  const { t, locale, themePreference, contentFontSize } = useI18n();
  return (
    <span data-testid="probe">
      {t("globalSettings.language")}|{locale}|{themePreference}|{contentFontSize}
    </span>
  );
}

describe("I18nProvider", () => {
  it("exposes t and defaults locale to zh", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("语言");
    expect(text).toContain("zh");
    expect(text).toContain("light");
  });

  it("throws when useI18n is used without a provider", () => {
    function NoProvider() {
      useI18n();
      return null;
    }
    expect(() => render(<NoProvider />)).toThrow(/I18nProvider/);
  });
});
