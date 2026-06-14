export type SettingsLocale = "en" | "zh";

export interface SettingsMessages {
  agentActionsColumn: string;
  deleteAgentProfile: string;
  deleteAgentProfileConfirm: (profileName: string) => string;
}

const SETTINGS_MESSAGES: Record<SettingsLocale, SettingsMessages> = {
  en: {
    agentActionsColumn: "Actions",
    deleteAgentProfile: "Delete",
    deleteAgentProfileConfirm: (profileName: string) =>
      `Are you sure you want to delete Agent Profile "${profileName}"?`,
  },
  zh: {
    agentActionsColumn: "操作",
    deleteAgentProfile: "删除",
    deleteAgentProfileConfirm: (profileName: string) =>
      `确认删除 Agent Profile「${profileName}」吗？`,
  },
};

export function getSettingsMessages(
  locale: SettingsLocale = "en",
): SettingsMessages {
  return SETTINGS_MESSAGES[locale];
}
