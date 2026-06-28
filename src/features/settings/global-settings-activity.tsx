import { SlidersHorizontal, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useI18n } from "../../shared/i18n/i18n";
import type { ThemePreference } from "../../shared/i18n/messages";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";

const SETTINGS_MENU_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;
const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

export function GlobalSettingsActivity() {
  const { messages, setThemePreference, themePreference } = useI18n();
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
        <nav
          className="settings-menu"
          aria-label={messages.globalSettings.settingsMenu}
        >
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
                clampSettingsMenuWidth(currentWidth - SIDEBAR_RESIZE_STEP),
              );
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSettingsMenuWidth((currentWidth) =>
                clampSettingsMenuWidth(currentWidth + SIDEBAR_RESIZE_STEP),
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
              <Card>
                <CardContent className="grid gap-[26px] p-7">
                  <section className="grid min-w-0 gap-3.5">
                    <h4 className="m-0 text-[15px] font-bold leading-[1.3]">
                      {messages.globalSettings.theme}
                    </h4>
                    <div className="grid min-w-0 grid-cols-3 gap-4">
                      {THEME_OPTIONS.map((themeOption) => (
                        <Button
                          key={themeOption}
                          variant="ghost"
                          aria-pressed={themePreference === themeOption}
                          onClick={() => setThemePreference(themeOption)}
                          className={cn(
                            "grid h-auto gap-2.5 px-0 py-0 text-center font-normal text-muted-foreground hover:bg-transparent",
                            themePreference === themeOption &&
                              "font-bold text-foreground hover:bg-transparent",
                          )}
                        >
                          <ThemePreview theme={themeOption} />
                          <span className="text-[15px] leading-[1.3]">
                            {messages.globalSettings[themeOption]}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </section>
                </CardContent>
              </Card>
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

function ThemePreview({ theme }: { theme: ThemePreference }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-[clamp(108px,12vw,126px)] grid-rows-[28px_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-dialog)] border bg-background",
        theme === "dark" &&
          "border-ring shadow-[0_0_0_2px_var(--ring)] [background:#0c0d10]",
      )}
      style={previewThemeStyle(theme)}
    >
      <span className="flex items-center gap-1.5 px-3.5">
        <span className="size-[9px] rounded-full bg-[#ff5f57]" />
        <span className="size-[9px] rounded-full bg-[#ffbd2e]" />
        <span className="size-[9px] rounded-full bg-[#28c840]" />
      </span>
      <span
        className="grid min-h-0"
        style={{
          gridTemplateColumns: "32% minmax(0,1fr)",
          ...previewBodyStyle(theme),
        }}
      >
        <span
          className="grid auto-rows-min gap-2.5 min-w-0 p-5 px-3.5"
          style={previewSideStyle(theme)}
        >
          <span
            className="block h-[7px] w-[60%] rounded-full"
            style={{ background: previewSideLineColor(theme) }}
          />
          <span
            className="block h-[7px] w-[46%] rounded-full"
            style={{ background: previewSideLineColor(theme) }}
          />
        </span>
        <span className="grid auto-rows-min gap-2.5 min-w-0 p-5 px-3.5 [background:var(--theme-preview-surface)]">
          <span
            className="block h-[7px] w-[84%] rounded-full"
            style={{ background: previewMainLineColor(theme) }}
          />
          <span
            className="block h-[7px] w-[96%] rounded-full"
            style={{ background: previewMainLineColor(theme) }}
          />
          <span
            className="block h-[7px] w-[64%] rounded-full"
            style={{ background: previewMainLineColor(theme) }}
          />
        </span>
      </span>
    </span>
  );
}

function previewThemeStyle(theme: ThemePreference): CSSProperties {
  if (theme === "light") {
    return { ["--theme-preview-surface" as string]: "#ffffff" };
  }
  if (theme === "dark") {
    return { ["--theme-preview-surface" as string]: "#0c0d10" };
  }
  // system
  return { ["--theme-preview-surface" as string]: "#ffffff" };
}

function previewBodyStyle(theme: ThemePreference): CSSProperties {
  if (theme === "system") {
    return {
      background: "linear-gradient(90deg, #ffffff 0 50%, #0b0b0c 50%)",
    };
  }
  if (theme === "dark") {
    return { background: "#0c0d10" };
  }
  return { background: "#ffffff" };
}

function previewSideStyle(theme: ThemePreference): CSSProperties {
  return {
    background: theme === "dark" ? "#0c0d10" : "#ffffff",
    borderRight: `1px solid ${theme === "system" ? "#272a30" : "var(--color-border)"}`,
  };
}

function previewSideLineColor(theme: ThemePreference): string {
  if (theme === "dark") {
    return "#3a3f47";
  }
  if (theme === "system") {
    return "#8a8f98";
  }
  return "var(--color-border-strong)";
}

function previewMainLineColor(theme: ThemePreference): string {
  if (theme === "dark") {
    return "#3a3f47";
  }
  if (theme === "system") {
    return "#3a3f47";
  }
  return "var(--color-border-strong)";
}

function clampSettingsMenuWidth(width: number) {
  return Math.min(
    SETTINGS_MENU_MAX_WIDTH,
    Math.max(SETTINGS_MENU_MIN_WIDTH, width),
  );
}
