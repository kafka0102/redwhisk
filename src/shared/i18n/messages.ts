export type Locale = "en" | "zh";
export type ThemePreference = "light";

export interface I18nMessages {
  app: {
    activityBarLabel: string;
    agents: string;
    globalSettings: string;
    issues: string;
    projectSettings: string;
    settings: string;
  };
  globalSettings: {
    chinese: string;
    english: string;
    language: string;
    light: string;
    preferences: string;
    settings: string;
    settingsMenu: string;
    theme: string;
  };
  settings: {
    actions: string;
    agents: string;
    autoCommit: string;
    command: string;
    completionStrategy: string;
    configuredAgents: string;
    delete: string;
    deleteConfirm: (profileName: string) => string;
    general: string;
    globalScope: string;
    loading: string;
    manual: string;
    menuLabel: string;
    name: string;
    newAgent: string;
    noAgents: string;
    projectName: string;
    projectScope: string;
    save: string;
    saving: string;
    scope: string;
    splitterLabel: string;
    status: string;
    type: string;
    workflowSkill: string;
  };
  issues: {
    backlog: string;
    done: string;
    inProgress: string;
    newIssue: string;
    review: string;
    title: string;
  };
  agentsFeature: {
    done: string;
    inProgress: string;
    noDoneSessions: string;
    noInProgressSessions: string;
    noReviewSessions: string;
    review: string;
  };
}

export const LOCALE_STORAGE_KEY = "redwhisk.locale";
export const THEME_STORAGE_KEY = "redwhisk.theme";

export const I18N_MESSAGES: Record<Locale, I18nMessages> = {
  en: {
    app: {
      activityBarLabel: "Activity Bar",
      agents: "Agents",
      globalSettings: "Global Settings",
      issues: "Issues",
      projectSettings: "Project Settings",
      settings: "Settings",
    },
    globalSettings: {
      chinese: "中文",
      english: "English",
      language: "Language",
      light: "Light",
      preferences: "Preferences",
      settings: "Settings",
      settingsMenu: "Global Settings menu",
      theme: "Theme",
    },
    settings: {
      actions: "Actions",
      agents: "Agents",
      autoCommit: "Auto Commit",
      command: "Command",
      completionStrategy: "Git completion strategy",
      configuredAgents: "Configured agents",
      delete: "Delete",
      deleteConfirm: (profileName) =>
        `Are you sure you want to delete Agent Profile "${profileName}"?`,
      general: "General",
      globalScope: "Global",
      loading: "Loading...",
      manual: "Manual",
      menuLabel: "Settings menu",
      name: "Name",
      newAgent: "New agent",
      noAgents: "No agents",
      projectName: "Project Name",
      projectScope: "Project",
      save: "Save",
      saving: "Saving...",
      scope: "Scope",
      splitterLabel: "Resize settings menu",
      status: "Settings status",
      type: "Type",
      workflowSkill: "Workflow Skill",
    },
    issues: {
      backlog: "Backlog",
      done: "Done",
      inProgress: "In Progress",
      newIssue: "New Issue",
      review: "Review",
      title: "Issues",
    },
    agentsFeature: {
      done: "Done",
      inProgress: "In Progress",
      noDoneSessions: "No done sessions.",
      noInProgressSessions: "No in-progress sessions.",
      noReviewSessions: "No review sessions.",
      review: "Review",
    },
  },
  zh: {
    app: {
      activityBarLabel: "活动栏",
      agents: "Agents",
      globalSettings: "全局设置",
      issues: "Issues",
      projectSettings: "项目设置",
      settings: "Settings",
    },
    globalSettings: {
      chinese: "中文",
      english: "English",
      language: "语言",
      light: "Light",
      preferences: "偏好设置",
      settings: "设置",
      settingsMenu: "全局设置菜单",
      theme: "主题",
    },
    settings: {
      actions: "操作",
      agents: "Agents",
      autoCommit: "自动提交",
      command: "命令",
      completionStrategy: "Git 完成策略",
      configuredAgents: "已配置 agents",
      delete: "删除",
      deleteConfirm: (profileName) => `确认删除 Agent Profile「${profileName}」吗？`,
      general: "通用",
      globalScope: "Global",
      loading: "加载中...",
      manual: "手动",
      menuLabel: "设置菜单",
      name: "名称",
      newAgent: "New agent",
      noAgents: "暂无 agents",
      projectName: "Project 名称",
      projectScope: "Project",
      save: "保存",
      saving: "保存中...",
      scope: "范围",
      splitterLabel: "调整设置菜单宽度",
      status: "设置状态",
      type: "类型",
      workflowSkill: "Workflow Skill",
    },
    issues: {
      backlog: "待办",
      done: "已完成",
      inProgress: "进行中",
      newIssue: "新建议题",
      review: "待验收",
      title: "议题",
    },
    agentsFeature: {
      done: "已完成",
      inProgress: "进行中",
      noDoneSessions: "暂无已完成的 Session。",
      noInProgressSessions: "暂无进行中的 Session。",
      noReviewSessions: "暂无待验收的 Session。",
      review: "待验收",
    },
  },
};

export function getInitialLocale(): Locale {
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return storedLocale === "zh" || storedLocale === "en" ? storedLocale : "en";
  } catch {
    return "en";
  }
}

export function getInitialThemePreference(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "light" ? storedTheme : "light";
  } catch {
    return "light";
  }
}
