import {
  HelpCircle,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useI18n } from "../../shared/i18n/i18n";
import {
  CONTENT_FONT_SIZE_OPTIONS,
  type ContentFontSize,
  type Locale,
  type ThemePreference,
} from "../../shared/i18n/messages";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import { UserProfilePanel } from "./user-profile-panel";

const SETTINGS_MENU_DEFAULT_WIDTH = DEFAULT_ACTIVITY_SIDEBAR_WIDTH;
const SETTINGS_MENU_MIN_WIDTH = 180;
const SETTINGS_MENU_MAX_WIDTH = 420;
const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];
const CONTENT_FONT_SIZE_ITEMS = CONTENT_FONT_SIZE_OPTIONS.map((size) => ({
  value: String(size),
  label: String(size),
}));
type GlobalSettingsSection = "profile" | "preferences";

export function GlobalSettingsActivity() {
  const {
    messages,
    locale,
    setLocale,
    setThemePreference,
    themePreference,
    contentFontSize,
    setContentFontSize,
    notificationReminder,
    setNotificationReminder,
    t,
  } = useI18n();
  const [settingsMenuWidth, setSettingsMenuWidth] = useState(
    SETTINGS_MENU_DEFAULT_WIDTH,
  );
  const [activeSection, setActiveSection] =
    useState<GlobalSettingsSection>("profile");
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
            Icon={UserRound}
            isActive={activeSection === "profile"}
            label={t("globalSettings.profile")}
            onClick={() => setActiveSection("profile")}
          />
          <SettingsMenuItem
            Icon={SlidersHorizontal}
            isActive={activeSection === "preferences"}
            label={preferencesLabel}
            onClick={() => setActiveSection("preferences")}
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
          {activeSection === "profile" ? (
            <UserProfilePanel />
          ) : (
            <section
              className="settings-section settings-section--global-preferences"
              aria-label={preferencesLabel}
            >
              <div className="settings-section__header">
                <h3>{preferencesLabel}</h3>
              </div>
              <div className="settings-section__body">
                <Card>
                  <CardContent className="grid gap-5 p-7">
                    <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-start gap-x-6 gap-y-3">
                      <h4 className="m-0 pt-3 text-[15px] font-bold leading-[1.3]">
                        {messages.globalSettings.theme}
                      </h4>
                      <div className="grid min-w-0 grid-cols-3 gap-3">
                        {THEME_OPTIONS.map((themeOption) => (
                          <Button
                            key={themeOption}
                            variant="ghost"
                            aria-pressed={themePreference === themeOption}
                            onClick={() => setThemePreference(themeOption)}
                            className={cn(
                              "grid h-auto min-w-0 gap-3 rounded-[var(--radius-card)] border border-border bg-background px-4 py-4 text-center font-normal text-muted-foreground hover:bg-[var(--color-surface-muted)]",
                              themePreference === themeOption &&
                                "border-[var(--color-border-strong)] bg-[var(--color-accent-muted)] font-medium text-foreground hover:bg-[var(--color-accent-muted)]",
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
                    <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
                      <h4 className="m-0 text-[15px] font-bold leading-[1.3]">
                        {messages.globalSettings.language}
                      </h4>
                      <div className="min-w-0">
                        <Select
                          items={[
                            {
                              value: "zh",
                              label: messages.globalSettings.chinese,
                            },
                            {
                              value: "en",
                              label: messages.globalSettings.english,
                            },
                          ]}
                          value={locale}
                          onValueChange={(value) => {
                            setLocale(value as Locale);
                          }}
                        >
                          <SelectTrigger
                            aria-label={messages.globalSettings.language}
                            className="w-[200px]"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="zh">
                              {messages.globalSettings.chinese}
                            </SelectItem>
                            <SelectItem value="en">
                              {messages.globalSettings.english}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </section>
                    <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
                      <h4 className="m-0 text-[15px] font-bold leading-[1.3]">
                        {messages.globalSettings.contentFontSize}
                      </h4>
                      <div className="min-w-0">
                        <Select
                          items={CONTENT_FONT_SIZE_ITEMS}
                          value={String(contentFontSize)}
                          onValueChange={(value) => {
                            setContentFontSize(
                              Number(value) as ContentFontSize,
                            );
                          }}
                        >
                          <SelectTrigger
                            aria-label={messages.globalSettings.contentFontSize}
                            className="w-[200px]"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONTENT_FONT_SIZE_OPTIONS.map((size) => (
                              <SelectItem key={size} value={String(size)}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </section>
                    <section className="grid min-w-0 grid-cols-[120px_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
                      <h4 className="m-0 flex items-center gap-1.5 text-[15px] font-bold leading-[1.3]">
                        {messages.globalSettings.notificationReminder}
                        <Tooltip>
                          <TooltipTrigger
                            type="button"
                            aria-label={
                              messages.globalSettings
                                .notificationReminderTooltip
                            }
                            className="inline-flex items-center text-muted-foreground hover:text-foreground"
                          >
                            <HelpCircle size={14} strokeWidth={1.9} />
                          </TooltipTrigger>
                          <TooltipContent>
                            {
                              messages.globalSettings
                                .notificationReminderTooltip
                            }
                          </TooltipContent>
                        </Tooltip>
                      </h4>
                      <div className="min-w-0">
                        <Select
                          value={String(notificationReminder)}
                          onValueChange={(value) => {
                            setNotificationReminder(value === "true");
                          }}
                        >
                          <SelectTrigger
                            aria-label={
                              messages.globalSettings.notificationReminder
                            }
                            className="w-[200px]"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">
                              {messages.globalSettings.notificationReminderOn}
                            </SelectItem>
                            <SelectItem value="false">
                              {messages.globalSettings.notificationReminderOff}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </section>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function SettingsMenuItem({
  Icon,
  isActive,
  label,
  onClick,
}: {
  Icon: LucideIcon;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="settings-menu__item"
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
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
        "grid h-[112px] w-full max-w-[148px] justify-self-center grid-rows-[28px_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-dialog)] border bg-background",
        theme === "dark" && "[background:#0c0d10]",
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
