import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { useI18n } from "../../shared/i18n/i18n";
import {
  detectTuiHookRegistration,
  enableCodexHooksFeature,
  installTuiHook,
  uninstallTuiHook,
  type TuiHookAgentKind,
  type TuiHookRegistrationStatus,
} from "./settings-commands";

export function TuiHookRegistrationCard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<TuiHookRegistrationStatus | null>(null);

  const refresh = useCallback(() => {
    void detectTuiHookRegistration().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const installDisabled = status?.channelAvailable === false;

  return (
    <section className="mt-4 min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">
        {t("settings.tuiHookTitle")}
      </h3>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <p>{t("settings.tuiHookScopeNotice")}</p>
        <p>{t("settings.tuiHookTrustNotice")}</p>
        <p>{t("settings.tuiHookKeepOthersNotice")}</p>
        {status && !status.channelAvailable ? (
          <p role="status">{t("settings.tuiHookChannelUnavailable")}</p>
        ) : null}
      </div>
      {status ? (
        <ul className="mt-3 space-y-3">
          <TuiHookAgentRow
            agent="codex"
            label={t("settings.tuiHookCodex")}
            registered={status.codexRegistered}
            installDisabled={installDisabled}
            showFeatureAction={!status.codexHooksFeatureEnabled}
            onChanged={setStatus}
            onRecheck={refresh}
          />
          <TuiHookAgentRow
            agent="grok"
            label={t("settings.tuiHookGrok")}
            registered={status.grokRegistered}
            installDisabled={installDisabled}
            showFeatureAction={false}
            onChanged={setStatus}
            onRecheck={refresh}
          />
        </ul>
      ) : null}
    </section>
  );
}

interface TuiHookAgentRowProps {
  agent: TuiHookAgentKind;
  label: string;
  registered: boolean;
  installDisabled: boolean;
  showFeatureAction: boolean;
  onChanged: (status: TuiHookRegistrationStatus) => void;
  onRecheck: () => void;
}

function TuiHookAgentRow({
  agent,
  label,
  registered,
  installDisabled,
  showFeatureAction,
  onChanged,
  onRecheck,
}: TuiHookAgentRowProps) {
  const { t } = useI18n();

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <span>
        {registered
          ? t("settings.tuiHookStatusRegistered")
          : t("settings.tuiHookStatusUnregistered")}
      </span>
      {registered ? (
        <span>{t("settings.tuiHookStatusTrustMayBeRequired")}</span>
      ) : null}
      {showFeatureAction ? (
        <>
          <span>{t("settings.tuiHookFeatureDisabled")}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void enableCodexHooksFeature().then(onChanged);
            }}
          >
            {t("settings.tuiHookEnableFeature")}
          </Button>
        </>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={installDisabled}
        onClick={() => {
          void installTuiHook({ agent }).then(onChanged);
        }}
      >
        {t("settings.tuiHookInstall")}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void uninstallTuiHook({ agent }).then(onChanged);
        }}
      >
        {t("settings.tuiHookUninstall")}
      </Button>
      <Button type="button" variant="outline" onClick={onRecheck}>
        {t("settings.tuiHookRecheck")}
      </Button>
    </li>
  );
}
