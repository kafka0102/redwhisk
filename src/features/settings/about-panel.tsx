import { openUrl } from "@tauri-apps/plugin-opener";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import appLogo from "@/assets/images/app-logo.png";
import {
  getUpdateStatus,
  type UpdateStatus,
} from "../../shared/commands/app-update-commands";
import { isCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

type CheckFeedback =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "updateAvailable"; version: string; releaseUrl: string }
  | { kind: "ignored"; version: string; releaseUrl: string | null }
  | { kind: "error"; message: string };

function feedbackFromStatus(status: UpdateStatus): CheckFeedback {
  if (status.error) {
    return { kind: "error", message: status.error };
  }

  if (
    status.hasUpdate &&
    status.latestVersion &&
    status.ignoredVersion === status.latestVersion
  ) {
    return {
      kind: "ignored",
      version: status.latestVersion,
      releaseUrl: status.releaseUrl,
    };
  }

  if (status.hasUpdate && status.latestVersion && status.releaseUrl) {
    return {
      kind: "updateAvailable",
      version: status.latestVersion,
      releaseUrl: status.releaseUrl,
    };
  }

  return { kind: "upToDate" };
}

export function AboutPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [feedback, setFeedback] = useState<CheckFeedback>({ kind: "idle" });
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.resolve()
      .then(() => getUpdateStatus({ forceRefresh: false }))
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {
        // 关于页首次静默加载失败时仍展示产品信息；版本号留空直至手动检查。
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = useCallback(async () => {
    if (isChecking) {
      return;
    }

    setIsChecking(true);
    setFeedback({ kind: "checking" });

    try {
      const next = await getUpdateStatus({ forceRefresh: true });
      setStatus(next);
      setFeedback(feedbackFromStatus(next));
    } catch (error: unknown) {
      const message = isCommandError(error)
        ? error.message
        : error instanceof Error && error.message
          ? error.message
          : t("globalSettings.checkFailed");
      setFeedback({ kind: "error", message });
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, t]);

  async function handleOpenRelease(url: string) {
    try {
      await openUrl(url);
    } catch {
      // 打开失败静默；用户可重试。
    }
  }

  const versionText = status?.currentVersion
    ? t("globalSettings.versionLabel", { version: status.currentVersion })
    : t("globalSettings.versionUnknown");

  return (
    <section className="about-panel" aria-label={t("globalSettings.about")}>
      <div className="about-panel__content">
        <img
          className="about-panel__logo"
          src={appLogo}
          alt=""
          width={96}
          height={96}
        />
        <h2 className="about-panel__name">{t("globalSettings.productName")}</h2>
        <div className="about-panel__version-row">
          <span className="about-panel__version">{versionText}</span>
          <button
            className="about-panel__check"
            type="button"
            aria-label={t("globalSettings.checkForUpdates")}
            disabled={isChecking}
            onClick={() => {
              void handleCheck();
            }}
          >
            {isChecking ? (
              <LoaderCircle
                aria-hidden="true"
                className="about-panel__check-spin"
                size={16}
                strokeWidth={1.9}
              />
            ) : (
              <RefreshCw aria-hidden="true" size={16} strokeWidth={1.9} />
            )}
          </button>
        </div>
        <div className="about-panel__feedback" role="status" aria-live="polite">
          {feedback.kind === "checking" ? (
            <span>{t("globalSettings.checkingForUpdates")}</span>
          ) : null}
          {feedback.kind === "upToDate" ? (
            <span>{t("globalSettings.upToDate")}</span>
          ) : null}
          {feedback.kind === "updateAvailable" ? (
            <button
              className="about-panel__feedback-link"
              type="button"
              onClick={() => {
                void handleOpenRelease(feedback.releaseUrl);
              }}
            >
              {t("globalSettings.updateAvailable", {
                version: feedback.version,
              })}
            </button>
          ) : null}
          {feedback.kind === "ignored" ? (
            <span className="about-panel__feedback-stack">
              <span>
                {t("globalSettings.updateIgnored", {
                  version: feedback.version,
                })}
              </span>
              {feedback.releaseUrl ? (
                <button
                  className="about-panel__feedback-link"
                  type="button"
                  onClick={() => {
                    void handleOpenRelease(feedback.releaseUrl!);
                  }}
                >
                  {t("globalSettings.openRelease")}
                </button>
              ) : null}
            </span>
          ) : null}
          {feedback.kind === "error" ? (
            <span className="about-panel__feedback-error">
              {t("globalSettings.checkFailedDetail", {
                message: feedback.message,
              })}
            </span>
          ) : null}
        </div>
        <p className="about-panel__description">
          {t("globalSettings.productDescription")}
        </p>
      </div>
    </section>
  );
}
