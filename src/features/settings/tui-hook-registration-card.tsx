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
  const { messages } = useI18n();
  const copy = messages.settings;
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
        {copy.tuiHookTitle}
      </h3>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <p>{copy.tuiHookScopeNotice}</p>
        <p>{copy.tuiHookTrustNotice}</p>
        <p>{copy.tuiHookKeepOthersNotice}</p>
        {status && !status.channelAvailable ? (
          <p role="status">{copy.tuiHookChannelUnavailable}</p>
        ) : null}
      </div>
      {status ? (
        <ul className="mt-3 space-y-3">
          <TuiHookAgentRow
            agent="codex"
            label={copy.tuiHookCodex}
            registered={status.codexRegistered}
            installDisabled={installDisabled}
            showFeatureAction={!status.codexHooksFeatureEnabled}
            onChanged={setStatus}
            onRecheck={refresh}
          />
          <TuiHookAgentRow
            agent="grok"
            label={copy.tuiHookGrok}
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
  const { messages } = useI18n();
  const copy = messages.settings;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <span>
        {registered
          ? copy.tuiHookStatusRegistered
          : copy.tuiHookStatusUnregistered}
      </span>
      {registered ? <span>{copy.tuiHookStatusTrustMayBeRequired}</span> : null}
      {showFeatureAction ? (
        <>
          <span>{copy.tuiHookFeatureDisabled}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void enableCodexHooksFeature().then(onChanged);
            }}
          >
            {copy.tuiHookEnableFeature}
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
        {copy.tuiHookInstall}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void uninstallTuiHook({ agent }).then(onChanged);
        }}
      >
        {copy.tuiHookUninstall}
      </Button>
      <Button type="button" variant="outline" onClick={onRecheck}>
        {copy.tuiHookRecheck}
      </Button>
    </li>
  );
}
