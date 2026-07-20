import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useConfirmDialog } from "@/components/ui/use-confirm-dialog";
import { useI18n } from "../../../shared/i18n/i18n";
import type { AgentProfileRecord } from "../../settings/settings-commands";
import {
  filterLaunchVisibleAgentProfiles,
  resolveAgentProfileLaunchEligibility,
} from "../agent-launch-eligibility";

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
  // ADR-0020 决策 4：会话入口隐藏 enabled=false 的 profile；
  // 决策 5：opencode/grok 保留显示但置灰「暂不支持启动」不可选。
  const visibleProfiles = useMemo(
    () => filterLaunchVisibleAgentProfiles(availableAgentProfiles),
    [availableAgentProfiles],
  );
  const directLaunchProfile =
    visibleProfiles.length === 1 &&
    resolveAgentProfileLaunchEligibility(visibleProfiles[0]).selectable
      ? visibleProfiles[0]
      : null;
  // 单可见项且可选 → 直接启动；其它（多可见 / 单可见但不可选）→ 展开菜单让用户
  // 看到置灰说明。0 可见 → 弹「无可用 agent」对话框（沿用既有行为）。
  const shouldExpandMenu =
    visibleProfiles.length > 0 && directLaunchProfile === null;
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

    if (visibleProfiles.length === 0) {
      await handleOpenNoAgentDialog();
      return;
    }

    if (directLaunchProfile) {
      await handleCreateSession(directLaunchProfile);
      return;
    }

    setIsMenuOpen((currentOpen) => !currentOpen);
  }

  return (
    <>
      <div className="agents-session-create-menu">
        <button
          aria-expanded={shouldExpandMenu ? isMenuOpen : undefined}
          aria-haspopup={shouldExpandMenu ? "menu" : undefined}
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
            {visibleProfiles.map((profile) => {
              const eligibility = resolveAgentProfileLaunchEligibility(profile);
              return (
                <button
                  key={profile.id}
                  aria-disabled={eligibility.selectable ? undefined : true}
                  className="agents-session-toolbar__menu-item"
                  disabled={!eligibility.selectable}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    if (!eligibility.selectable) {
                      return;
                    }
                    void handleCreateSession(profile);
                  }}
                >
                  <span>{profile.name}</span>
                  {!eligibility.selectable ? (
                    <span className="agents-session-toolbar__menu-item-note">
                      {messages.agentsFeature.unsupportedLaunch}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {confirmationDialog}
    </>
  );
}
