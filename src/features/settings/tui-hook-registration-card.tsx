import { Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { useAlertDialog } from "@/components/ui/use-alert-dialog";
import { getCommandErrorMessage } from "@/shared/commands/command-error";
import { getAgentLogoSrc } from "../agents/agent-visuals";
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
  const { alertDialog, showAlert } = useAlertDialog();
  const [status, setStatus] = useState<TuiHookRegistrationStatus | null>(null);

  const reportFailure = useCallback(
    (error: unknown) => {
      showAlert({ message: getCommandErrorMessage(error, t), type: "error" });
    },
    [showAlert, t],
  );

  const refresh = useCallback(() => {
    void detectTuiHookRegistration().then(setStatus).catch(reportFailure);
  }, [reportFailure]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const installDisabled = status?.channelAvailable === false;

  return (
    <TooltipProvider>
      <section className="mt-4 min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4">
        {alertDialog}
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.tuiHookTitle")}
          </h3>
          <HelpTip
            label={t("settings.tuiHookHelpLabel")}
            text={[
              t("settings.tuiHookScopeNotice"),
              t("settings.tuiHookTrustNotice"),
              t("settings.tuiHookKeepOthersNotice"),
              ...(status && !status.channelAvailable
                ? [t("settings.tuiHookChannelUnavailable")]
                : []),
            ].join(" ")}
          />
        </div>
        {status && !status.channelAvailable ? (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {t("settings.tuiHookChannelShort")}
          </p>
        ) : null}
        {status ? (
          <ul className="mt-3 space-y-2">
            <TuiHookAgentRow
              agent="codex"
              label={t("settings.tuiHookCodex")}
              registered={status.codexRegistered}
              installDisabled={installDisabled}
              showFeatureAction={!status.codexHooksFeatureEnabled}
              onChanged={setStatus}
              onFailed={reportFailure}
              onRecheck={refresh}
            />
            <TuiHookAgentRow
              agent="grok"
              label={t("settings.tuiHookGrok")}
              registered={status.grokRegistered}
              installDisabled={installDisabled}
              showFeatureAction={false}
              onChanged={setStatus}
              onFailed={reportFailure}
              onRecheck={refresh}
            />
          </ul>
        ) : null}
      </section>
    </TooltipProvider>
  );
}

function HelpTip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="grid size-4 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <Info aria-hidden="true" className="size-3" />
          </button>
        }
      />
      <TooltipContent className="block max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

interface TuiHookAgentRowProps {
  agent: TuiHookAgentKind;
  label: string;
  registered: boolean;
  installDisabled: boolean;
  showFeatureAction: boolean;
  onChanged: (status: TuiHookRegistrationStatus) => void;
  onFailed: (error: unknown) => void;
  onRecheck: () => void;
}

function TuiHookAgentRow({
  agent,
  label,
  registered,
  installDisabled,
  showFeatureAction,
  onChanged,
  onFailed,
  onRecheck,
}: TuiHookAgentRowProps) {
  const { t } = useI18n();
  const statusLabel = showFeatureAction
    ? t("settings.tuiHookFeatureShort")
    : registered
      ? t("settings.tuiHookStatusRegistered")
      : t("settings.tuiHookStatusUnregistered");
  const statusDetail = showFeatureAction
    ? t("settings.tuiHookFeatureDisabled")
    : registered
      ? t("settings.tuiHookStatusTrustMayBeRequired")
      : null;
  const statusTone =
    registered && !showFeatureAction
      ? "bg-[var(--color-lane-review-marker)]"
      : showFeatureAction
        ? "bg-[var(--color-lane-running-marker)]"
        : "bg-muted-foreground";

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span className="flex w-24 min-w-0 items-center gap-2">
        <img
          alt={label}
          className="block size-[22px]"
          src={getAgentLogoSrc(agent)}
        />
        <span className="font-medium">{label}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${statusTone}`}
        />
        {statusDetail ? (
          <Tooltip>
            <TooltipTrigger
              render={<span className="cursor-help">{statusLabel}</span>}
            />
            <TooltipContent>{statusDetail}</TooltipContent>
          </Tooltip>
        ) : (
          <span>{statusLabel}</span>
        )}
      </span>
      <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
        {showFeatureAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void enableCodexHooksFeature()
                      .then(onChanged)
                      .catch(onFailed);
                  }}
                >
                  {t("settings.tuiHookEnableFeatureShort")}
                </Button>
              }
            />
            <TooltipContent>
              {t("settings.tuiHookEnableFeature")}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={installDisabled}
          onClick={() => {
            void installTuiHook({ agent }).then(onChanged).catch(onFailed);
          }}
        >
          {t("settings.tuiHookInstall")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void uninstallTuiHook({ agent }).then(onChanged).catch(onFailed);
          }}
        >
          {t("settings.tuiHookUninstall")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onRecheck}>
          {t("settings.tuiHookRecheck")}
        </Button>
      </span>
    </li>
  );
}
