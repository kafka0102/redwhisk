import {
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ThemePreference } from "../../shared/i18n/messages";

const SETTINGS_MENU_DEFAULT_WIDTH = 180;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;
const SETTINGS_MENU_STEP = 16;
const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

export function GlobalSettingsActivity() {
  const {
    locale,
    messages,
    setLocale,
    setThemePreference,
    themePreference,
  } = useI18n();
  const [settingsMenuWidth, setSettingsMenuWidth] = useState(
    SETTINGS_MENU_DEFAULT_WIDTH,
  );
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const preferencesLabel = messages.globalSettings.preferences;

  const clearDragState = useCallback(() => {
    if (!dragStateRef.current) {
      return;
    }

    dragStateRef.current = null;
    window.document.body.style.cursor = "";
    window.document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (!dragStateRef.current) {
        return;
      }

      const nextWidth =
        dragStateRef.current.startWidth +
        event.clientX -
        dragStateRef.current.startX;
      setSettingsMenuWidth(clampSettingsMenuWidth(nextWidth));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", clearDragState);
    window.addEventListener("blur", clearDragState);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", clearDragState);
      window.removeEventListener("blur", clearDragState);
      clearDragState();
    };
  }, [clearDragState]);

  return (
    <main
      className="activity-surface activity-surface--settings activity-surface--global-settings"
      style={
        {
          "--settings-menu-width": `${settingsMenuWidth}px`,
        } as CSSProperties
      }
    >
      <div className="settings-layout">
        <nav className="settings-menu" aria-label={messages.globalSettings.settingsMenu}>
          <SettingsMenuItem
            Icon={SlidersHorizontal}
            isActive
            label={preferencesLabel}
          />
        </nav>

        <div
          aria-label={messages.settings.splitterLabel}
          aria-orientation="vertical"
          aria-valuemax={SETTINGS_MENU_MAX_WIDTH}
          aria-valuemin={SETTINGS_MENU_MIN_WIDTH}
          aria-valuenow={settingsMenuWidth}
          className="settings-splitter"
          role="separator"
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            dragStateRef.current = {
              startWidth: settingsMenuWidth,
              startX: event.clientX,
            };
            window.document.body.style.cursor = "col-resize";
            window.document.body.style.userSelect = "none";
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth - SETTINGS_MENU_STEP),
              );
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth + SETTINGS_MENU_STEP),
              );
            }

            if (event.key === "Home") {
              event.preventDefault();
              setSettingsMenuWidth(SETTINGS_MENU_MIN_WIDTH);
            }

            if (event.key === "End") {
              event.preventDefault();
              setSettingsMenuWidth(SETTINGS_MENU_MAX_WIDTH);
            }
          }}
        />

        <div className="settings-content settings-content--global-preferences">
          <section
            className="settings-section settings-section--global-preferences"
            aria-label={preferencesLabel}
          >
            <div className="settings-section__header">
              <h3>{preferencesLabel}</h3>
            </div>
            <div className="settings-section__body">
              <div className="settings-card global-preferences-card">
                <section className="global-preferences-section">
                  <h4>{messages.globalSettings.language}</h4>
                  <div className="global-language-options">
                    <button
                      className="global-language-option"
                      type="button"
                      aria-pressed={locale === "en"}
                      onClick={() => setLocale("en")}
                    >
                      {messages.globalSettings.english}
                    </button>
                    <button
                      className="global-language-option"
                      type="button"
                      aria-pressed={locale === "zh"}
                      onClick={() => setLocale("zh")}
                    >
                      {messages.globalSettings.chinese}
                    </button>
                  </div>
                </section>

                <section className="global-preferences-section">
                  <h4>{messages.globalSettings.theme}</h4>
                  <div className="global-theme-grid">
                    {THEME_OPTIONS.map((themeOption) => (
                      <button
                        className="global-theme-option"
                        type="button"
                        key={themeOption}
                        aria-pressed={themePreference === themeOption}
                        onClick={() => setThemePreference(themeOption)}
                      >
                        <span
                          className={`global-theme-preview global-theme-preview--${themeOption}`}
                          aria-hidden="true"
                        >
                          <span className="global-theme-preview__dots">
                            <span className="global-theme-preview__dot global-theme-preview__dot--red" />
                            <span className="global-theme-preview__dot global-theme-preview__dot--yellow" />
                            <span className="global-theme-preview__dot global-theme-preview__dot--green" />
                          </span>
                          <span className="global-theme-preview__body">
                            <span className="global-theme-preview__side">
                              <span className="global-theme-preview__line global-theme-preview__line--short" />
                              <span className="global-theme-preview__line global-theme-preview__line--shorter" />
                            </span>
                            <span className="global-theme-preview__main">
                              <span className="global-theme-preview__line global-theme-preview__line--long" />
                              <span className="global-theme-preview__line global-theme-preview__line--longer" />
                              <span className="global-theme-preview__line global-theme-preview__line--medium" />
                            </span>
                          </span>
                        </span>
                        <span className="global-theme-option__label">
                          {messages.globalSettings[themeOption]}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SettingsMenuItem({
  Icon,
  isActive,
  label,
}: {
  Icon: LucideIcon;
  isActive: boolean;
  label: string;
}) {
  return (
    <button
      className="settings-menu__item"
      type="button"
      aria-pressed={isActive}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.9} />
      <span>{label}</span>
    </button>
  );
}

function clampSettingsMenuWidth(width: number) {
  return Math.min(
    SETTINGS_MENU_MAX_WIDTH,
    Math.max(SETTINGS_MENU_MIN_WIDTH, width),
  );
}
