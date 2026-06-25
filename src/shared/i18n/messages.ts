export type Locale = "en" | "zh";
export type ThemePreference = "light" | "dark" | "system";

export interface I18nMessages {
  app: {
    activityBarLabel: string;
    agents: string;
    designSystem: string;
    globalSettings: string;
    issues: string;
    localDataStatus: string;
    openProjectStatus: string;
    projectCreationStatus: string;
    projectSettings: string;
    settings: string;
    terminals: string;
    workbench: (projectName: string) => string;
  };
  globalSettings: {
    chinese: string;
    dark: string;
    english: string;
    language: string;
    light: string;
    preferences: string;
    settings: string;
    settingsMenu: string;
    system: string;
    theme: string;
  };
  toast: {
    deleteSuccess: string;
  };
  settings: {
    actions: string;
    agent: string;
    agents: string;
    autoCommit: string;
    cancel: string;
    close: string;
    closeMessage: string;
    closeTerminalDialog: string;
    color: string;
    command: string;
    commandAvailable: (commandName: string) => string;
    commandTesting: string;
    commandTest: string;
    completionStrategy: string;
    configuredAgents: string;
    delete: string;
    deleteConfirm: (profileName: string) => string;
    deleteTerminal: (terminalName: string) => string;
    editAgent: string;
    editLabel: string;
    editTerminal: (terminalName: string) => string;
    general: string;
    globalScope: string;
    labelNameRequired: string;
    labelNameTooLong: string;
    labels: string;
    labelStatus: string;
    loading: string;
    loadingLabels: string;
    loadingSkills: string;
    loadingTerminals: string;
    manual: string;
    menuLabel: string;
    name: string;
    newAgent: string;
    newLabel: string;
    newTerminal: string;
    noAgents: string;
    noLabels: string;
    noSkills: string;
    noTerminals: string;
    none: string;
    projectName: string;
    projectScope: string;
    repositoryPath: string;
    save: string;
    saving: string;
    scope: string;
    agentProfileName: string;
    agentTypeLabel: string;
    agentCommand: string;
    skillLoadFailed: string;
    splitterLabel: string;
    status: string;
    terminalPath: string;
    terminalUnavailable: string;
    terminals: string;
    projectTerminals: string;
    terminalsStatus: string;
    type: string;
    workflowSkill: string;
    workflowSkillSingle: string;
    worktreePath: string;
    worktreeSetupAfterCreation: string;
    colorPresets: string;
    noMatches: string;
  };
  projectHome: {
    chooseFolder: string;
    createProject: string;
    creatingProject: string;
    localProjects: string;
    newProject: string;
    openProject: (projectName: string) => string;
    pathUnavailable: string;
    projects: string;
    searchProjects: string;
    searchProjectsPlaceholder: string;
    selectGitRepository: string;
    clearSearch: string;
  };
  projectSwitcher: {
    createProject: string;
    currentProject: string;
    currentProjectWithName: (projectName: string) => string;
    menu: string;
    pathUnavailable: string;
    status: string;
  };
  createProject: {
    autoCommit: string;
    create: string;
    creating: string;
    dialogTitle: string;
    gitCompletionStrategy: string;
    selectGitRepository: string;
    status: string;
    worktreeSetupPlaceholder: string;
  };
  issues: {
    actionsLabel: string;
    addAttachment: string;
    addLabel: string;
    attachments: string;
    attachmentPreview: string;
    backlog: string;
    back: string;
    backReadonly: string;
    backEditable: string;
    closeAttachmentPreview: string;
    create: string;
    delete: string;
    deleteReadonly: string;
    deleteEditable: string;
    deleteConfirmMessage: string;
    deleteConfirmTitle: string;
    deleteConfirmTitleReadonly: string;
    description: string;
    describeTask: string;
    detailFallbackTitle: string;
    detailRegionLabel: string;
    detailTitle: (issueId: number) => string;
    done: string;
    edit: string;
    editLabels: string;
    emptyLane: string;
    finalPrompt: string;
    inProgress: string;
    issueSummary: string;
    issueSummaryStatus: string;
    issuesKanban: string;
    issuesStatus: string;
    labels: string;
    labelsLoading: string;
    loadingIssues: string;
    loadingSummary: string;
    newIssue: string;
    noDiagnostics: string;
    noLabels: string;
    noSessionLinked: string;
    openLinkedSession: (sessionId: number) => string;
    openStatusOptions: string;
    prompt: string;
    review: string;
    run: string;
    runIssue: (issueId: number) => string;
    runStatus: string;
    save: string;
    session: string;
    selectLabels: string;
    start: string;
    status: string;
    statusLabel: string;
    summaryClose: string;
    runDialogClose: string;
    commitStrategy: string;
    title: string;
    titleField: string;
    titlePlaceholder: string;
    viewSummary: string;
    workflowSkill: string;
    developmentMode: string;
    currentBranch: string;
    targetBranch: string;
    worktree: string;
    dialogStatus: string;
    agentProfile: string;
    agentAutoCommit: string;
  };
  issueSummary: {
    closedAt: string;
    commitHash: string;
    completion: string;
    diagnostics: string;
    failureReason: string;
    issue: string;
    linkedSession: (sessionId: number) => string;
    logPath: string;
    noCommit: string;
    noLinkedSession: string;
    option: string;
    recordedAt: string;
    result: string;
    session: string;
    sessionStatus: string;
    source: string;
    startedAt: string;
    status: string;
    unknown: string;
    updatedAt: string;
  };
  agentsFeature: {
    agentSessions: string;
    agentsStatus: string;
    closeCompletionConfirmation: string;
    closeIssueDetails: string;
    completionConfirmation: string;
    confirmDeleteSession: string;
    deleteSession: string;
    done: string;
    gitSummary: string;
    inProgress: string;
    issueDetails: string;
    issueEyebrow: string;
    issueNotFound: string;
    noDetailsProvided: string;
    loadingIssue: string;
    loadingSessions: string;
    markDone: string;
    markReview: string;
    newSession: string;
    noChangedFiles: string;
    noDoneSessions: string;
    noInProgressSessions: string;
    noProfilesForAgentType: string;
    noReviewSessions: string;
    noSessions: string;
    openSessionSidePanel: string;
    openStatusOptions: string;
    openTerminal: string;
    closeSessionTerminal: (terminalName: string) => string;
    resizeSessionList: string;
    resizeSessionSidePanel: string;
    review: string;
    running: string;
    attentionRequested: string;
    attentionOutputComplete: string;
    sessionDialog: string;
    sessionDialogStatus: string;
    sessionInlineMaximize: string;
    sessionInlineRestore: string;
    sessionInlineTabs: string;
    sessionSidePanel: string;
    sessionTerminals: string;
    newInlineTerminal: string;
    sessionWorkspace: string;
    start: string;
    starting: string;
    temporarySessionDefaultPrompt: string;
    temporarySessionDefaultTitle: string;
    titleField: string;
    detailsField: string;
    promptField: string;
    currentModelType: string;
    addAttachment: string;
    removeAttachment: (fileName: string) => string;
    attachmentsSavedHint: string;
    selectModel: string;
    thinkMode: string;
    cancelCurrentTurn: string;
    sendMessage: string;
    messageInput: string;
    messageInputForm: string;
    messagePlaceholder: string;
    contextUsed: (percent: number) => string;
    modelLoadFailed: (message: string) => string;
    messageStream: string;
    emptyMessageStream: string;
    thinking: string;
    reasoningTitle: string;
    structuredSessionView: string;
    readOnlyCompletedIssue: string;
    permissionCard: string;
    sessionListControls: string;
    sessionListView: string;
    sessionRunning: string;
    sessionStatus: (statusLabel: string) => string;
    issueDetailsTitle: string;
    fileTree: string;
    refreshChanges: string;
    changes: string;
    files: string;
    uncommitted: string;
    committed: string;
    loadingChanges: string;
    noUncommittedChanges: string;
    committedChangesNotImplemented: string;
    loadingFileTree: string;
    noFiles: string;
    loadingFile: string;
    loadingDiff: string;
    selectFile: string;
    selectChangedFile: string;
    fileUnavailable: string;
    diffUnavailable: string;
    binaryPreviewUnavailable: string;
    largeFilePreviewUnavailable: string;
    fileView: (fileName: string) => string;
    diffView: (fileName: string) => string;
    closeTab: (label: string) => string;
    sessionTab: string;
    query: string;
    mode: string;
    noSearchMatches: string;
    subSession: (sessionId: string | number) => string;
    subSessionStarted: string;
    todoList: string;
    contextCompacted: string;
    workspaceLabel: string;
    contextWindow: string;
    toolShell: string;
    toolEdit: string;
    toolWrite: string;
    toolRead: string;
    toolSearch: string;
    toolTask: string;
    toolPlan: string;
    toolRunning: string;
    toolFailed: string;
    toolCanceled: string;
    exitCode: (exitCode: number) => string;
    changedFiles: string;
    changedFilesCount: (count: number) => string;
    head: (head: string) => string;
    completionOption: (option: string) => string;
    unavailableInCurrentScope: string;
  };
  designSystem: {
    title: string;
    subtitle: string;
    overview: string;
    issuePrototype: string;
    colors: string;
    typography: string;
    buttons: string;
    inputs: string;
    cards: string;
    layouts: string;
    spacing: string;
    borderRadius: string;
    save: string;
    cancel: string;
    close: string;
    edit: string;
    attach: string;
    delete: string;
    newIssue: string;
    action: string;
    primary: string;
    confirm: string;
    disabled: string;
    check: string;
    closeButton: string;
    enterIssueTitle: string;
    cannotEdit: string;
    noIssues: string;
    myPage: string;
    subtitleHere: string;
    pageContent: string;
  };
}

export const LOCALE_STORAGE_KEY = "redwhisk.locale";
export const THEME_STORAGE_KEY = "redwhisk.theme";

export const I18N_MESSAGES: Record<Locale, I18nMessages> = {
  en: {
    app: {
      activityBarLabel: "Activity Bar",
      agents: "Agents",
      designSystem: "Design System",
      globalSettings: "Global Settings",
      issues: "Issues",
      localDataStatus: "Local data status",
      openProjectStatus: "Project open status",
      projectCreationStatus: "Project creation status",
      projectSettings: "Project Settings",
      settings: "Settings",
      terminals: "Terminals",
      workbench: (projectName) => `${projectName} workbench`,
    },
    globalSettings: {
      chinese: "中文",
      dark: "Dark",
      english: "English",
      language: "Language",
      light: "Light",
      preferences: "Preferences",
      settings: "Settings",
      settingsMenu: "Global Settings menu",
      system: "System",
      theme: "Theme",
    },
    toast: {
      deleteSuccess: "Deleted successfully",
    },
    settings: {
      actions: "Actions",
      agent: "Agent",
      agents: "Agents",
      autoCommit: "Auto Commit",
      cancel: "Cancel",
      close: "Close",
      closeMessage: "Close message",
      closeTerminalDialog: "Close terminal dialog",
      color: "Color",
      command: "Command",
      commandAvailable: (commandName) => `Command available: ${commandName}`,
      commandTesting: "Testing...",
      commandTest: "测试",
      completionStrategy: "Git completion strategy",
      configuredAgents: "Configured agents",
      delete: "Delete",
      deleteConfirm: (profileName) =>
        `Are you sure you want to delete Agent Profile "${profileName}"?`,
      deleteTerminal: (terminalName) => `Delete terminal "${terminalName}"`,
      editAgent: "Edit Agent",
      editLabel: "Edit label",
      editTerminal: (terminalName) => `Edit terminal "${terminalName}"`,
      general: "General",
      globalScope: "Global",
      labelNameRequired: "Label name is required.",
      labelNameTooLong: "Label name must be 15 characters or fewer.",
      labels: "Labels",
      labelStatus: "Label status",
      loading: "Loading...",
      loadingLabels: "Loading labels...",
      loadingSkills: "Loading skills...",
      loadingTerminals: "Loading terminals...",
      manual: "Manual",
      menuLabel: "Settings menu",
      name: "Name",
      newAgent: "New agent",
      newLabel: "New label",
      newTerminal: "New terminal",
      noAgents: "No agents",
      noLabels: "No labels",
      noSkills: "No skills",
      noTerminals: "No terminals yet.",
      none: "None",
      projectName: "Project Name",
      projectScope: "Project",
      repositoryPath: "Repository path",
      save: "Save",
      saving: "Saving...",
      scope: "Scope",
      agentProfileName: "Agent profile name",
      agentTypeLabel: "Agent type",
      agentCommand: "Agent command",
      skillLoadFailed: "Skill load failed",
      splitterLabel: "Resize settings menu",
      status: "Settings status",
      terminalPath: "Terminal path",
      terminalUnavailable: "This terminal is not running right now.",
      terminals: "Terminals",
      projectTerminals: "Project terminals",
      terminalsStatus: "Terminals status",
      type: "Type",
      workflowSkill: "Workflow Skills",
      workflowSkillSingle: "Workflow Skill",
      worktreePath: "Worktree path",
      worktreeSetupAfterCreation: "Worktree setup after creation",
      colorPresets: "Color presets",
      noMatches: "No matches",
    },
    projectHome: {
      chooseFolder: "Choose folder",
      createProject: "Create Project",
      creatingProject: "Creating Project",
      localProjects: "Local projects",
      newProject: "New Project",
      openProject: (projectName) => `Open project ${projectName}`,
      pathUnavailable: "path unavailable",
      projects: "Projects",
      searchProjects: "Search projects",
      searchProjectsPlaceholder: "searching projects",
      selectGitRepository: "Select Git Repository",
      clearSearch: "Clear search",
    },
    projectSwitcher: {
      createProject: "创建项目",
      currentProject: "Current project",
      currentProjectWithName: (projectName) => `Current project ${projectName}`,
      menu: "Project Switcher",
      pathUnavailable: "path unavailable",
      status: "Project switcher status",
    },
    createProject: {
      autoCommit: "Auto Commit",
      create: "Create Project",
      creating: "Creating Project",
      dialogTitle: "New Project",
      gitCompletionStrategy: "Git completion strategy",
      selectGitRepository: "Select Git Repository",
      status: "Project creation status",
      worktreeSetupPlaceholder: "请输入创建 worktree 后的初始化操作",
    },
    issues: {
      actionsLabel: "Issue actions",
      addAttachment: "Attach file",
      addLabel: "添加标签",
      attachments: "Attachments",
      attachmentPreview: "Attachment Preview",
      backlog: "Backlog",
      back: "Back",
      backReadonly: "Back",
      backEditable: "返回",
      closeAttachmentPreview: "Close attachment preview",
      create: "创建 Issue",
      delete: "删除",
      deleteReadonly: "Delete",
      deleteEditable: "删除",
      deleteConfirmMessage: "删除后无法恢复。确认删除当前 Issue 吗？",
      deleteConfirmTitle: "确认删除 Issue",
      deleteConfirmTitleReadonly: "Delete issue",
      description: "Description",
      describeTask: "Describe the task",
      detailFallbackTitle: "Issue Detail",
      detailRegionLabel: "Issue Detail",
      detailTitle: (issueId) => `Issue #${issueId}`,
      done: "Done",
      edit: "Edit Issue",
      editLabels: "编辑 Labels",
      emptyLane: "no issues",
      finalPrompt: "Final prompt",
      inProgress: "In Progress",
      issueSummary: "Issue Summary",
      issueSummaryStatus: "Summary status",
      issuesKanban: "Issues kanban",
      issuesStatus: "Issues status",
      labels: "Labels",
      labelsLoading: "Loading labels...",
      loadingIssues: "Loading issues...",
      loadingSummary: "Loading summary...",
      newIssue: "New Issue",
      noDiagnostics: "No diagnostics.",
      noLabels: "No labels.",
      noSessionLinked: "No session linked.",
      openLinkedSession: (sessionId) => `Open linked session #${sessionId}`,
      openStatusOptions: "Open status options",
      prompt: "Prompt",
      review: "Review",
      run: "Run",
      runIssue: (issueId) => `Run Issue #${issueId}`,
      runStatus: "Run status",
      save: "保存",
      session: "Session",
      selectLabels: "Select labels",
      start: "Start",
      status: "Status",
      statusLabel: "Issue status",
      summaryClose: "Close issue summary",
      runDialogClose: "Close run dialog",
      commitStrategy: "Commit strategy",
      title: "Issues",
      titleField: "Title",
      titlePlaceholder: "Issue title",
      viewSummary: "View Summary",
      workflowSkill: "Workflow skill",
      developmentMode: "Development mode",
      currentBranch: "Current branch",
      targetBranch: "Target branch",
      worktree: "Worktree",
      dialogStatus: "Dialog status",
      agentProfile: "Agent profile",
      agentAutoCommit: "Agent auto commit",
    },
    issueSummary: {
      closedAt: "Closed",
      commitHash: "Commit hash",
      completion: "Completion",
      diagnostics: "Diagnostics",
      failureReason: "Failure reason",
      issue: "Issue",
      linkedSession: (sessionId) => `Linked session #${sessionId}`,
      logPath: "Log path",
      noCommit: "No commit created",
      noLinkedSession: "No linked session",
      option: "Option",
      recordedAt: "Recorded",
      result: "Result",
      session: "Session",
      sessionStatus: "Session status",
      source: "Source",
      startedAt: "Started",
      status: "Status",
      unknown: "unknown",
      updatedAt: "Updated",
    },
    agentsFeature: {
      agentSessions: "Agent sessions",
      agentsStatus: "Agents status",
      closeCompletionConfirmation: "Close completion confirmation",
      closeIssueDetails: "Close issue details",
      completionConfirmation: "Completion Confirmation",
      confirmDeleteSession: "确认删除该 Session？",
      deleteSession: "删除",
      done: "Done",
      gitSummary: "Git summary",
      inProgress: "In Progress",
      issueDetails: "Issue details",
      issueEyebrow: "Issue",
      issueNotFound: "Linked issue no longer exists.",
      noDetailsProvided: "No details provided.",
      loadingIssue: "Loading issue...",
      loadingSessions: "Loading sessions...",
      markDone: "Mark done",
      markReview: "Mark review",
      newSession: "New session",
      noChangedFiles: "No changed files.",
      noDoneSessions: "No done sessions.",
      noInProgressSessions: "No in-progress sessions.",
      noProfilesForAgentType:
        "No Agent Profile is available for the current agent type.",
      noReviewSessions: "No review sessions.",
      noSessions: "No sessions.",
      openSessionSidePanel: "打开 Session 侧边栏",
      openStatusOptions: "Open status options",
      openTerminal: "打开终端",
      closeSessionTerminal: (terminalName) => `关闭终端 ${terminalName}`,
      resizeSessionList: "Resize session list",
      resizeSessionSidePanel: "Resize session side panel",
      review: "Review",
      running: "运行中",
      attentionRequested: "Codex 需要确认",
      attentionOutputComplete: "输出完成",
      sessionDialog: "Session Dialog",
      sessionDialogStatus: "Session dialog status",
      sessionInlineMaximize: "最大化 Session 主内容",
      sessionInlineRestore: "恢复 Session 终端",
      sessionInlineTabs: "Session terminal tabs",
      sessionSidePanel: "Session side panel",
      sessionTerminals: "Session terminals",
      newInlineTerminal: "新增终端",
      sessionWorkspace: "Session workspace",
      start: "Start",
      starting: "Starting...",
      temporarySessionDefaultPrompt:
        "Ask Codex to help with the current project without linking an issue.",
      temporarySessionDefaultTitle: "Untitled Session",
      titleField: "Title",
      detailsField: "Details",
      promptField: "Prompt",
      currentModelType: "当前模型类型",
      addAttachment: "添加附件",
      removeAttachment: (fileName) => `移除附件 ${fileName}`,
      attachmentsSavedHint: "附件已保存，暂不随消息发送",
      selectModel: "选择模型",
      thinkMode: "Think 模式",
      cancelCurrentTurn: "终止当前任务",
      sendMessage: "发送消息",
      messageInput: "输入消息",
      messageInputForm: "Message input",
      messagePlaceholder: "输入消息，Enter 发送，Shift+Enter 换行",
      contextUsed: (percent) => `已使用 ${percent}%`,
      modelLoadFailed: (message) => `模型加载失败：${message}`,
      messageStream: "Agent 会话消息流",
      emptyMessageStream: "发送一条消息开始对话。",
      thinking: "正在思考…",
      reasoningTitle: "Thinking",
      structuredSessionView: "Agent 结构化会话视图",
      readOnlyCompletedIssue: "已完成的 Issue 不能继续运行。",
      permissionCard: "Agent 权限审批卡片",
      sessionListControls: "Session list controls",
      sessionListView: "Session list view",
      sessionRunning: "Session 正在运行",
      sessionStatus: (statusLabel) => `Session 状态：${statusLabel}`,
      issueDetailsTitle: "Issue details",
      fileTree: "Project file tree",
      refreshChanges: "刷新变更",
      changes: "变更",
      files: "文件",
      uncommitted: "未提交",
      committed: "已提交",
      loadingChanges: "Loading changes...",
      noUncommittedChanges: "No uncommitted changes.",
      committedChangesNotImplemented:
        "Committed changes are not implemented yet.",
      loadingFileTree: "Loading file tree...",
      noFiles: "No files.",
      loadingFile: "Loading file...",
      loadingDiff: "Loading diff...",
      selectFile: "Select a file.",
      selectChangedFile: "Select a changed file.",
      fileUnavailable: "File unavailable",
      diffUnavailable: "Diff unavailable",
      binaryPreviewUnavailable: "二进制文件不可预览。",
      largeFilePreviewUnavailable: "This file is too large to preview.",
      fileView: (fileName) => `${fileName} file`,
      diffView: (fileName) => `${fileName} diff`,
      closeTab: (label) => `Close ${label}`,
      sessionTab: "Session",
      query: "Query",
      mode: "Mode",
      noSearchMatches: "No matches returned",
      subSession: (sessionId) => `Sub-session: ${sessionId}`,
      subSessionStarted: "Sub-session started",
      todoList: "待办清单",
      contextCompacted: "上下文已压缩",
      workspaceLabel: "Project terminals workspace",
      contextWindow: "上下文窗口",
      toolShell: "Shell",
      toolEdit: "Edit",
      toolWrite: "Write",
      toolRead: "Read",
      toolSearch: "Search",
      toolTask: "Task",
      toolPlan: "Plan",
      toolRunning: "Running",
      toolFailed: "Failed",
      toolCanceled: "Canceled",
      exitCode: (exitCode) => `exit ${exitCode}`,
      changedFiles: "Changed files",
      changedFilesCount: (count) => `Changed files: ${count}`,
      head: (head) => `HEAD: ${head}`,
      completionOption: (option) => `Completion option: ${option}`,
      unavailableInCurrentScope: "Unavailable in current scope",
    },
    designSystem: {
      title: "Design System",
      subtitle: "RedWhisk UI Component Library",
      overview: "Overview",
      issuePrototype: "Issue prototype",
      colors: "Colors",
      typography: "Typography",
      buttons: "Buttons",
      inputs: "Inputs",
      cards: "Cards",
      layouts: "Layouts",
      spacing: "Spacing",
      borderRadius: "Border Radius",
      save: "Save",
      cancel: "Cancel",
      close: "Close",
      edit: "Edit",
      attach: "Attach",
      delete: "Delete",
      newIssue: "New Issue",
      action: "Action",
      primary: "Primary",
      confirm: "Confirm",
      disabled: "Disabled",
      check: "Check",
      closeButton: "Close",
      enterIssueTitle: "Enter issue title",
      cannotEdit: "Cannot edit this",
      noIssues: "No issues",
      myPage: "My Page",
      subtitleHere: "Subtitle here",
      pageContent: "Page content goes here",
    },
  },
  zh: {
    app: {
      activityBarLabel: "活动栏",
      agents: "Agents",
      designSystem: "设计系统",
      globalSettings: "全局设置",
      issues: "Issues",
      localDataStatus: "本地数据状态",
      openProjectStatus: "打开项目状态",
      projectCreationStatus: "创建项目状态",
      projectSettings: "项目设置",
      settings: "Settings",
      terminals: "Terminals",
      workbench: (projectName) => `${projectName} 工作台`,
    },
    globalSettings: {
      chinese: "中文",
      dark: "深色",
      english: "English",
      language: "语言",
      light: "浅色",
      preferences: "偏好设置",
      settings: "设置",
      settingsMenu: "全局设置菜单",
      system: "跟随系统",
      theme: "主题",
    },
    toast: {
      deleteSuccess: "删除成功",
    },
    settings: {
      actions: "操作",
      agent: "Agent",
      agents: "Agents",
      autoCommit: "自动提交",
      cancel: "取消",
      close: "关闭",
      closeMessage: "关闭消息",
      closeTerminalDialog: "关闭终端弹窗",
      color: "颜色",
      command: "命令",
      commandAvailable: (commandName) => `命令可用：${commandName}`,
      commandTesting: "测试中...",
      commandTest: "测试",
      completionStrategy: "Git 完成策略",
      configuredAgents: "已配置 Agents",
      delete: "删除",
      deleteConfirm: (profileName) =>
        `确认删除 Agent Profile「${profileName}」吗？`,
      deleteTerminal: (terminalName) => `删除终端「${terminalName}」`,
      editAgent: "编辑 Agent",
      editLabel: "编辑标签",
      editTerminal: (terminalName) => `编辑终端「${terminalName}」`,
      general: "通用",
      globalScope: "全局",
      labelNameRequired: "标签名不能为空。",
      labelNameTooLong: "标签名不能超过 15 个字符。",
      labels: "Labels",
      labelStatus: "标签状态",
      loading: "加载中...",
      loadingLabels: "正在加载标签...",
      loadingSkills: "正在加载技能...",
      loadingTerminals: "正在加载终端...",
      manual: "手动",
      menuLabel: "设置菜单",
      name: "名称",
      newAgent: "新建 Agent",
      newLabel: "新建标签",
      newTerminal: "新建终端",
      noAgents: "暂无 Agents",
      noLabels: "暂无标签",
      noSkills: "暂无技能",
      noTerminals: "暂无终端。",
      none: "无",
      projectName: "项目名称",
      projectScope: "项目",
      repositoryPath: "仓库路径",
      save: "保存",
      saving: "保存中...",
      scope: "范围",
      agentProfileName: "Agent profile name",
      agentTypeLabel: "Agent type",
      agentCommand: "Agent command",
      skillLoadFailed: "技能加载失败",
      splitterLabel: "调整设置菜单宽度",
      status: "设置状态",
      terminalPath: "终端路径",
      terminalUnavailable: "该终端当前未运行。",
      terminals: "Terminals",
      projectTerminals: "Project terminals",
      terminalsStatus: "终端状态",
      type: "类型",
      workflowSkill: "工作流技能",
      workflowSkillSingle: "Workflow Skill",
      worktreePath: "Worktree 路径",
      worktreeSetupAfterCreation: "创建 worktree 后的初始化命令",
      colorPresets: "颜色预设",
      noMatches: "无匹配项",
    },
    projectHome: {
      chooseFolder: "选择目录",
      createProject: "创建项目",
      creatingProject: "创建项目中",
      localProjects: "本地项目",
      newProject: "新建项目",
      openProject: (projectName) => `打开项目 ${projectName}`,
      pathUnavailable: "路径不可用",
      projects: "项目",
      searchProjects: "搜索项目",
      searchProjectsPlaceholder: "搜索项目",
      selectGitRepository: "选择 Git 仓库",
      clearSearch: "清空搜索",
    },
    projectSwitcher: {
      createProject: "创建项目",
      currentProject: "当前项目",
      currentProjectWithName: (projectName) => `当前项目 ${projectName}`,
      menu: "项目切换器",
      pathUnavailable: "路径不可用",
      status: "项目切换器状态",
    },
    createProject: {
      autoCommit: "自动提交",
      create: "创建项目",
      creating: "创建项目中",
      dialogTitle: "新建项目",
      gitCompletionStrategy: "Git 完成策略",
      selectGitRepository: "选择 Git 仓库",
      status: "创建项目状态",
      worktreeSetupPlaceholder: "请输入创建 worktree 后的初始化命令",
    },
    issues: {
      actionsLabel: "Issue 操作",
      addAttachment: "添加附件",
      addLabel: "添加标签",
      attachments: "附件",
      attachmentPreview: "附件预览",
      backlog: "待办",
      back: "返回",
      backReadonly: "Back",
      backEditable: "返回",
      closeAttachmentPreview: "关闭附件预览",
      create: "创建 Issue",
      delete: "删除",
      deleteReadonly: "Delete",
      deleteEditable: "删除",
      deleteConfirmMessage: "删除后无法恢复。确认删除当前 Issue 吗？",
      deleteConfirmTitle: "确认删除 Issue",
      deleteConfirmTitleReadonly: "Delete issue",
      description: "描述",
      describeTask: "描述任务内容",
      detailFallbackTitle: "Issue 详情",
      detailRegionLabel: "Issue 详情",
      detailTitle: (issueId) => `Issue #${issueId}`,
      done: "已完成",
      edit: "编辑 Issue",
      editLabels: "编辑标签",
      emptyLane: "暂无 Issue",
      finalPrompt: "最终提示词",
      inProgress: "进行中",
      issueSummary: "Issue 总结",
      issueSummaryStatus: "总结状态",
      issuesKanban: "Issues 看板",
      issuesStatus: "Issues 状态",
      labels: "标签",
      labelsLoading: "正在加载标签...",
      loadingIssues: "正在加载 Issues...",
      loadingSummary: "正在加载总结...",
      newIssue: "新建 Issue",
      noDiagnostics: "暂无诊断信息。",
      noLabels: "暂无标签。",
      noSessionLinked: "暂无关联 Session。",
      openLinkedSession: (sessionId) => `打开关联 Session #${sessionId}`,
      openStatusOptions: "打开状态选项",
      prompt: "提示词",
      review: "待验收",
      run: "运行",
      runIssue: (issueId) => `运行 Issue #${issueId}`,
      runStatus: "运行状态",
      save: "保存",
      session: "Session",
      selectLabels: "选择标签",
      start: "开始",
      status: "状态",
      statusLabel: "Issue 状态",
      summaryClose: "关闭 Issue 总结",
      runDialogClose: "关闭运行弹窗",
      commitStrategy: "Commit strategy",
      title: "Issues",
      titleField: "标题",
      titlePlaceholder: "Issue 标题",
      viewSummary: "查看总结",
      workflowSkill: "工作流技能",
      developmentMode: "开发模式",
      currentBranch: "当前分支",
      targetBranch: "目标分支",
      worktree: "Worktree",
      dialogStatus: "弹窗状态",
      agentProfile: "Agent Profile",
      agentAutoCommit: "Agent auto commit",
    },
    issueSummary: {
      closedAt: "结束时间",
      commitHash: "提交哈希",
      completion: "完成信息",
      diagnostics: "诊断信息",
      failureReason: "失败原因",
      issue: "Issue",
      linkedSession: (sessionId) => `关联 Session #${sessionId}`,
      logPath: "日志路径",
      noCommit: "未产生提交",
      noLinkedSession: "暂无关联 Session",
      option: "选项",
      recordedAt: "记录时间",
      result: "结果",
      session: "Session",
      sessionStatus: "Session 状态",
      source: "来源",
      startedAt: "开始时间",
      status: "状态",
      unknown: "未知",
      updatedAt: "更新时间",
    },
    agentsFeature: {
      agentSessions: "Agent Sessions",
      agentsStatus: "Agents 状态",
      closeCompletionConfirmation: "关闭完成确认",
      closeIssueDetails: "关闭 Issue 详情",
      completionConfirmation: "完成确认",
      confirmDeleteSession: "确认删除该 Session？",
      deleteSession: "删除",
      done: "已完成",
      gitSummary: "Git 摘要",
      inProgress: "进行中",
      issueDetails: "Issue 详情",
      issueEyebrow: "Issue",
      issueNotFound: "关联的 Issue 已不存在。",
      noDetailsProvided: "暂无详情。",
      loadingIssue: "正在加载 Issue...",
      loadingSessions: "正在加载 Sessions...",
      markDone: "标记完成",
      markReview: "标记待验收",
      newSession: "新建 Session",
      noChangedFiles: "暂无变更文件。",
      noDoneSessions: "暂无已完成的 Session。",
      noInProgressSessions: "暂无进行中的 Session。",
      noProfilesForAgentType: "未找到可用于当前 Agent 类型的 Agent Profile。",
      noReviewSessions: "暂无待验收的 Session。",
      noSessions: "暂无 Session。",
      openSessionSidePanel: "打开 Session 侧边栏",
      openStatusOptions: "打开状态选项",
      openTerminal: "打开终端",
      closeSessionTerminal: (terminalName) => `关闭终端 ${terminalName}`,
      resizeSessionList: "调整 Session 列表宽度",
      resizeSessionSidePanel: "调整 Session 侧边栏宽度",
      review: "待验收",
      running: "运行中",
      attentionRequested: "需要确认",
      attentionOutputComplete: "输出完成",
      sessionDialog: "Session 弹窗",
      sessionDialogStatus: "Session 弹窗状态",
      sessionInlineMaximize: "最大化 Session 主内容",
      sessionInlineRestore: "恢复 Session 终端",
      sessionInlineTabs: "Session 终端标签",
      sessionSidePanel: "Session 侧边栏",
      sessionTerminals: "Session 终端",
      newInlineTerminal: "新增终端",
      sessionWorkspace: "Session 工作区",
      start: "开始",
      starting: "启动中...",
      temporarySessionDefaultPrompt:
        "请 Codex 在当前项目中协助处理任务，不关联具体 Issue。",
      temporarySessionDefaultTitle: "未命名 Session",
      titleField: "标题",
      detailsField: "详情",
      promptField: "提示词",
      currentModelType: "当前模型类型",
      addAttachment: "添加附件",
      removeAttachment: (fileName) => `移除附件 ${fileName}`,
      attachmentsSavedHint: "附件已保存，暂不随消息发送",
      selectModel: "选择模型",
      thinkMode: "Think 模式",
      cancelCurrentTurn: "终止当前任务",
      sendMessage: "发送消息",
      messageInput: "消息输入",
      messageInputForm: "消息表单",
      messagePlaceholder: "输入消息，Enter 发送，Shift+Enter 换行",
      contextUsed: (percent) => `已使用 ${percent}%`,
      modelLoadFailed: (message) => `模型加载失败：${message}`,
      messageStream: "Agent 会话消息流",
      emptyMessageStream: "发送一条消息开始对话。",
      thinking: "正在思考…",
      reasoningTitle: "正在思考…",
      structuredSessionView: "Agent 结构化会话视图",
      readOnlyCompletedIssue: "已完成的 Issue 不能继续运行。",
      permissionCard: "Agent 权限审批卡片",
      sessionListControls: "Session 列表控制区",
      sessionListView: "Session 列表视图",
      sessionRunning: "Session 正在运行",
      sessionStatus: (statusLabel) => `Session 状态：${statusLabel}`,
      issueDetailsTitle: "Issue 详情",
      fileTree: "项目文件树",
      refreshChanges: "刷新变更",
      changes: "变更",
      files: "文件",
      uncommitted: "未提交",
      committed: "已提交",
      loadingChanges: "正在加载变更...",
      noUncommittedChanges: "暂无未提交变更。",
      committedChangesNotImplemented: "已提交变更暂未实现。",
      loadingFileTree: "正在加载文件树...",
      noFiles: "暂无文件。",
      loadingFile: "正在加载文件...",
      loadingDiff: "正在加载 diff...",
      selectFile: "请选择文件。",
      selectChangedFile: "请选择变更文件。",
      fileUnavailable: "文件不可预览",
      diffUnavailable: "Diff 不可预览",
      binaryPreviewUnavailable: "二进制文件不可预览。",
      largeFilePreviewUnavailable: "文件过大，暂不预览。",
      fileView: (fileName) => `${fileName} 文件`,
      diffView: (fileName) => `${fileName} diff`,
      closeTab: (label) => `关闭 ${label}`,
      sessionTab: "Session",
      query: "查询",
      mode: "模式",
      noSearchMatches: "没有返回匹配项",
      subSession: (sessionId) => `子会话：${sessionId}`,
      subSessionStarted: "子会话已启动",
      todoList: "待办清单",
      contextCompacted: "上下文已压缩",
      workspaceLabel: "项目终端工作区",
      contextWindow: "上下文窗口",
      toolShell: "Shell",
      toolEdit: "编辑",
      toolWrite: "写入",
      toolRead: "读取",
      toolSearch: "搜索",
      toolTask: "任务",
      toolPlan: "计划",
      toolRunning: "运行中",
      toolFailed: "失败",
      toolCanceled: "已取消",
      exitCode: (exitCode) => `exit ${exitCode}`,
      changedFiles: "变更文件",
      changedFilesCount: (count) => `变更文件：${count}`,
      head: (head) => `HEAD：${head}`,
      completionOption: (option) => `完成选项：${option}`,
      unavailableInCurrentScope: "当前范围不可用",
    },
    designSystem: {
      title: "设计系统",
      subtitle: "RedWhisk UI 组件库",
      overview: "Overview",
      issuePrototype: "Issue prototype",
      colors: "Colors",
      typography: "Typography",
      buttons: "Buttons",
      inputs: "Inputs",
      cards: "Cards",
      layouts: "Layouts",
      spacing: "Spacing",
      borderRadius: "Border Radius",
      save: "Save",
      cancel: "Cancel",
      close: "Close",
      edit: "Edit",
      attach: "Attach",
      delete: "Delete",
      newIssue: "New Issue",
      action: "Action",
      primary: "Primary",
      confirm: "Confirm",
      disabled: "Disabled",
      check: "Check",
      closeButton: "Close",
      enterIssueTitle: "Enter issue title",
      cannotEdit: "Cannot edit this",
      noIssues: "No issues",
      myPage: "My Page",
      subtitleHere: "Subtitle here",
      pageContent: "Page content goes here",
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
    return isThemePreference(storedTheme) ? storedTheme : "light";
  } catch {
    return "light";
  }
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}
