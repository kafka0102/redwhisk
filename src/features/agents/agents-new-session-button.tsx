import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useI18n } from "../../shared/i18n/i18n";
import type { AgentProfileRecord } from "../settings/settings-commands";

interface AgentsNewSessionButtonProps {
  availableAgentProfiles: AgentProfileRecord[];
  hasAgentProfilesLoadError: boolean;
  isCreatingSession: boolean;
  isLoadingAgentProfiles: boolean;
  onCreateSession: (profile: AgentProfileRecord) => Promise<void> | void;
  onOpenProjectAgentSettings?: () => void;
}

export function AgentsNewSessionButton({
  availableAgentProfiles,
  hasAgentProfilesLoadError,
  isCreatingSession,
  isLoadingAgentProfiles,
  onCreateSession,
  onOpenProjectAgentSettings,
}: AgentsNewSessionButtonProps) {
  const { messages } = useI18n();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const hasMultipleProfiles = availableAgentProfiles.length > 1;
  const isDisabled =
    hasAgentProfilesLoadError || isLoadingAgentProfiles || isCreatingSession;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!isMenuOpen) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (buttonRef.current?.contains(target)) {
        return;
      }

      const menu = document.querySelector(".agents-session-create-menu");
      if (menu?.contains(target)) {
        return;
      }

      setIsMenuOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isMenuOpen]);

  async function handleCreateSession(profile: AgentProfileRecord) {
    setIsMenuOpen(false);

    try {
      await onCreateSession(profile);
    } finally {
      window.requestAnimationFrame(() => {
        buttonRef.current?.focus();
      });
    }
  }

  async function handleOpenNoAgentDialog() {
    const confirmed = await confirm({
      cancelLabel: messages.agentsFeature.openAgentSettingsNo,
      confirmLabel: messages.agentsFeature.openAgentSettingsYes,
      message: messages.agentsFeature.noAvailableAgentPrompt,
    });
    if (confirmed) {
      onOpenProjectAgentSettings?.();
    }
    window.requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  }

  async function handleButtonClick() {
    if (isDisabled) {
      return;
    }

    if (availableAgentProfiles.length === 0) {
      await handleOpenNoAgentDialog();
      return;
    }

    if (hasMultipleProfiles) {
      setIsMenuOpen((currentOpen) => !currentOpen);
      return;
    }

    const [profile] = availableAgentProfiles;
    if (profile) {
      await handleCreateSession(profile);
    }
  }

  return (
    <>
      <div className="agents-session-create-menu">
        <button
          aria-expanded={hasMultipleProfiles ? isMenuOpen : undefined}
          aria-haspopup={hasMultipleProfiles ? "menu" : undefined}
          aria-label={messages.agentsFeature.newSession}
          className="agents-toolbar-button"
          disabled={isDisabled}
          ref={buttonRef}
          type="button"
          onClick={() => {
            void handleButtonClick();
          }}
        >
          <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
        {isMenuOpen ? (
          <div className="agents-session-toolbar__menu" role="menu">
            {availableAgentProfiles.map((profile) => (
              <button
                key={profile.id}
                className="agents-session-toolbar__menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  void handleCreateSession(profile);
                }}
              >
                {profile.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {confirmationDialog}
    </>
  );
}
