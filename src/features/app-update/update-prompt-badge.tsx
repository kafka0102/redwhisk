import { X } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { useI18n } from "../../shared/i18n/i18n";
import type {
  DismissUpdatePromptAction,
  UpdateStatus,
} from "../../shared/commands/app-update-commands";
import { openReleasePage } from "./open-release-page";

interface UpdatePromptBadgeProps {
  status: UpdateStatus;
  onDismiss: (action: DismissUpdatePromptAction) => Promise<void>;
}

export function UpdatePromptBadge({
  status,
  onDismiss,
}: UpdatePromptBadgeProps) {
  const { t } = useI18n();
  const [isDismissing, setIsDismissing] = useState(false);

  if (!status.shouldShowPrompt || !status.latestVersion || !status.releaseUrl) {
    return null;
  }

  const tooltip = t("updatePrompt.tooltip", {
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
  });

  async function handleOpenRelease() {
    if (!status.releaseUrl) {
      return;
    }
    await openReleasePage(status.releaseUrl);
  }

  async function handleDismiss(action: DismissUpdatePromptAction) {
    if (isDismissing) {
      return;
    }
    setIsDismissing(true);
    try {
      await onDismiss(action);
    } finally {
      setIsDismissing(false);
    }
  }

  return (
    <div className="update-prompt">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            type="button"
            className="update-prompt__main"
            aria-label={t("updatePrompt.openRelease")}
            title={tooltip}
            onClick={() => {
              void handleOpenRelease();
            }}
          >
            <span className="update-prompt__label">
              {t("updatePrompt.label")}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="update-prompt__close"
          aria-label={t("updatePrompt.dismissMenu")}
          disabled={isDismissing}
        >
          <X aria-hidden="true" size={12} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
          <DropdownMenuItem
            disabled={isDismissing}
            onClick={() => {
              void handleDismiss("snooze7Days");
            }}
          >
            {t("updatePrompt.snooze7Days")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isDismissing}
            onClick={() => {
              void handleDismiss("ignoreVersion");
            }}
          >
            {t("updatePrompt.ignoreVersion")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
