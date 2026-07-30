import { describe, expect, it } from "vitest";

import {
  APP_THEME_PREFERENCE_CHANGED_EVENT,
  isAppThemePreferenceChangedEvent,
} from "./app-commands";

describe("app-commands theme preference event", () => {
  it("exports the cross-window event name", () => {
    expect(APP_THEME_PREFERENCE_CHANGED_EVENT).toBe(
      "app-theme-preference-changed",
    );
  });

  it("accepts valid preference payloads and rejects invalid ones", () => {
    expect(isAppThemePreferenceChangedEvent({ themePreference: "light" })).toBe(
      true,
    );
    expect(isAppThemePreferenceChangedEvent({ themePreference: "dark" })).toBe(
      true,
    );
    expect(
      isAppThemePreferenceChangedEvent({ themePreference: "system" }),
    ).toBe(true);
    expect(isAppThemePreferenceChangedEvent({ themePreference: "blue" })).toBe(
      false,
    );
    expect(isAppThemePreferenceChangedEvent(null)).toBe(false);
    expect(isAppThemePreferenceChangedEvent({})).toBe(false);
  });
});
