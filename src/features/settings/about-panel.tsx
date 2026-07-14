import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import appLogo from "@/assets/images/app-logo.png";
import { openReleasePage } from "../app-update/open-release-page";
import { useUpdateStatus } from "../app-update/use-update-status";
import type {
  UpdateCheckErrorCode,
  UpdateStatus,
} from "../../shared/commands/app-update-commands";
import { useI18n } from "../../shared/i18n/i18n";

function errorCodeMessage(
  t: (key: string) => string,
  errorCode: UpdateCheckErrorCode,
): string {
  switch (errorCode) {
    case "network":
      return t("globalSettings.checkFailedNetwork");
    case "invalidResponse":
      return t("globalSettings.checkFailedInvalidResponse");
    case "unknown":
      return t("globalSettings.checkFailedUnknown");
  }
}

function renderCheckFeedback(
  t: (key: string, params?: Record<string, string>) => string,
  status: UpdateStatus | null,
  isChecking: boolean,
  checkError: string | null,
  hasChecked: boolean,
  onOpenRelease: (url: string) => void,
): ReactNode {
  if (isChecking) {
    return <span>{t("globalSettings.checkingForUpdates")}</span>;
  }

  if (!hasChecked) {
    return null;
  }

  if (status?.errorCode) {
    return (
      <span className="about-panel__feedback-error">
        {errorCodeMessage(t, status.errorCode)}
      </span>
    );
  }

  if (checkError) {
    return (
      <span className="about-panel__feedback-error">
        {t("globalSettings.checkFailedUnknown")}
      </span>
    );
  }

  if (
    status?.hasUpdate &&
    status.latestVersion &&
    status.ignoredVersion === status.latestVersion
  ) {
    return (
      <span className="about-panel__feedback-stack">
        <span>
          {t("globalSettings.updateIgnored", {
            version: status.latestVersion,
          })}
        </span>
        {status.releaseUrl ? (
          <button
            className="about-panel__feedback-link"
            type="button"
            onClick={() => {
              onOpenRelease(status.releaseUrl!);
            }}
          >
            {t("globalSettings.openRelease")}
          </button>
        ) : null}
      </span>
    );
  }

  if (status?.hasUpdate && status.latestVersion && status.releaseUrl) {
    return (
      <button
        className="about-panel__feedback-link"
        type="button"
        onClick={() => {
          onOpenRelease(status.releaseUrl!);
        }}
      >
        {t("globalSettings.updateAvailable", {
          version: status.latestVersion,
        })}
      </button>
    );
  }

  return <span>{t("globalSettings.upToDate")}</span>;
}

export function AboutPanel() {
  const { t } = useI18n();
  const { status, isChecking, checkError, checkForUpdates } = useUpdateStatus();
  const [hasChecked, setHasChecked] = useState(false);

  async function handleCheck() {
    if (isChecking) {
      return;
    }
    await checkForUpdates();
    setHasChecked(true);
  }

  function handleOpenRelease(url: string) {
    void openReleasePage(url);
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
          {renderCheckFeedback(
            t,
            status,
            isChecking,
            checkError,
            hasChecked,
            handleOpenRelease,
          )}
        </div>
        <p className="about-panel__description">
          {t("globalSettings.productDescription")}
        </p>
      </div>
    </section>
  );
}
