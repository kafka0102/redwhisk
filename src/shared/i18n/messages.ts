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
    enableNotificationFloatingWindow: string;
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
    issueMarkedDone: string;
  };
  richText: {
    bold: string;
    heading: string;
    headingOne: string;
    headingTwo: string;
    normalText: string;
    orderedList: string;
    unorderedList: string;
  };
  agentNotifications: {
    needsInputTitle: (projectName: string) => string;
    permissionFallbackBody: string;
    sessionCompletedTitle: (projectName: string) => string;
    sessionCompletionFallbackSummary: string;
    sessionFailedTitle: (projectName: string) => string;
    sessionRecentMessagesLabel: string;
    sessionStatusLine: (title: string, status: string) => string;
    sessionSummaryLabel: string;
    sessionUpdatedTitle: (projectName: string) => string;
    turnCompletedBody: (sessionId: number) => string;
    turnFailedFallbackBody: string;
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
    previewAttachment: (displayName: string) => string;
    prompt: string;
    review: string;
    run: string;
    runIssue: (issueId: number) => string;
    runStatus: string;
    save: string;
    session: string;
    downloadAttachment: (displayName: string) => string;
    removeAttachment: (displayName: string) => string;
    selectLabels: string;
    start: string;
    starting: string;
    status: string;
    statusLabel: string;
    summaryClose: string;
    runDialogClose: string;
    commitStrategy: string;
    confirmCompleteWhileRunning: string;
    confirmMoveBackToStatus: (statusLabel: string) => string;
    confirmReturnToBacklog: string;
    confirmRunIssue: string;
    confirmTerminateAndReturnToBacklog: string;
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
    completionDirtyTitle: string;
    completionDirtyMessage: string;
    completionIgnoreDirty: string;
    completionHandleManually: string;
    completionExternalWorktreeTitle: string;
    completionExternalWorktreeMessage: (branch: string) => string;
    completionMergeAndDelete: string;
    completionSkipMerge: string;
    completionCancel: string;
    completionWaitingAgentCommit: string;
    completionNoCommitDetected: string;
    completionGitOperationBlocked: string;
    completionAgentMergeBlocked: string;
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
    sessionMonitor: string;
    sessionMonitorClose: string;
    sessionMonitorEmpty: string;
    sessionMonitorList: string;
    sessionMonitorMenu: string;
    sessionMonitorUpdatedAt: (updatedAt: string) => string;
    sessionMonitorView: string;
    sessionRunning: string;
    sessionClosed: string;
    sessionCrashed: string;
    sessionStopped: string;
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
      chinese: "Chinese",
      dark: "Dark",
      english: "English",
      enableNotificationFloatingWindow: "Enable notification floating window",
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
      issueMarkedDone: "该 issue 已标记完成",
    },
    richText: {
      bold: "Bold",
      heading: "Text style",
      headingOne: "Heading 1",
      headingTwo: "Heading 2",
      normalText: "Normal text",
      orderedList: "Ordered list",
      unorderedList: "Unordered list",
    },
    agentNotifications: {
      needsInputTitle: (projectName) => `${projectName} needs your input`,
      permissionFallbackBody: "Agent is waiting for approval or input.",
      sessionCompletedTitle: (projectName) =>
        `${projectName} session completed`,
      sessionCompletionFallbackSummary: "No final summary was captured.",
      sessionFailedTitle: (projectName) => `${projectName} session failed`,
      sessionRecentMessagesLabel: "Recent messages",
      sessionStatusLine: (title, status) =>
        `${title} finished with status ${status}.`,
      sessionSummaryLabel: "Summary",
      sessionUpdatedTitle: (projectName) => `${projectName} session updated`,
      turnCompletedBody: (sessionId) =>
        `Session #${sessionId} has finished the latest turn.`,
      turnFailedFallbackBody: "The latest agent turn failed.",
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
      commandTest: "Test",
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
      createProject: "Create Project",
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
      worktreeSetupPlaceholder:
        "Enter initialization steps to run after creating the worktree",
    },
    issues: {
      actionsLabel: "Issue actions",
      addAttachment: "Attach file",
      addLabel: "Add label",
      attachments: "Attachments",
      attachmentPreview: "Attachment Preview",
      backlog: "Backlog",
      back: "Back",
      backReadonly: "Back",
      backEditable: "Back",
      closeAttachmentPreview: "Close attachment preview",
      create: "Create Issue",
      delete: "Delete",
      deleteReadonly: "Delete",
      deleteEditable: "Delete",
      deleteConfirmMessage: "This cannot be undone. Delete the current Issue?",
      deleteConfirmTitle: "Delete Issue?",
      deleteConfirmTitleReadonly: "Delete issue",
      description: "Description",
      describeTask: "Describe the task",
      detailFallbackTitle: "Issue Detail",
      detailRegionLabel: "Issue Detail",
      detailTitle: (issueId) => `Issue #${issueId}`,
      done: "Done",
      edit: "Edit Issue",
      editLabels: "Edit labels",
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
      previewAttachment: (displayName) => `Preview ${displayName}`,
      prompt: "Prompt",
      review: "Review",
      run: "Run",
      runIssue: (issueId) => `Run Issue #${issueId}`,
      runStatus: "Run status",
      save: "Save",
      session: "Session",
      downloadAttachment: (displayName) => `Download ${displayName}`,
      removeAttachment: (displayName) => `Remove ${displayName}`,
      selectLabels: "Select labels",
      start: "Start",
      starting: "Starting...",
      status: "Status",
      statusLabel: "Issue status",
      summaryClose: "Close issue summary",
      runDialogClose: "Close run dialog",
      commitStrategy: "Commit strategy",
      confirmCompleteWhileRunning:
        "This issue is still running. Mark it as completed?",
      confirmMoveBackToStatus: (statusLabel) =>
        `Move this issue back to ${statusLabel}?`,
      confirmReturnToBacklog:
        "Are you sure you want to return this issue to Backlog?",
      confirmRunIssue: "确定要执行吗？",
      confirmTerminateAndReturnToBacklog:
        "This issue is still running. Stop it and return it to Backlog?",
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
      completionDirtyTitle: "Uncommitted changes",
      completionDirtyMessage:
        "This session has uncommitted local changes. Ignore them and continue completing the Issue?",
      completionIgnoreDirty: "Ignore and continue",
      completionHandleManually: "Handle manually",
      completionExternalWorktreeTitle: "External worktree",
      completionExternalWorktreeMessage: (branch) =>
        `This session is on external worktree branch ${branch}. Merge it and delete the worktree?`,
      completionMergeAndDelete: "Merge and delete",
      completionSkipMerge: "Complete without merge",
      completionCancel: "Cancel",
      completionWaitingAgentCommit: "Waiting for Agent commit.",
      completionNoCommitDetected: "No new commit was detected.",
      completionGitOperationBlocked:
        "A Git operation is in progress. Resolve it before completing.",
      completionAgentMergeBlocked:
        "Worktree merge is blocked. Handing it back to the Agent.",
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
      confirmDeleteSession: "Delete this Session?",
      deleteSession: "Delete",
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
      openSessionSidePanel: "Open session side panel",
      openStatusOptions: "Open status options",
      openTerminal: "Open terminal",
      closeSessionTerminal: (terminalName) => `Close terminal ${terminalName}`,
      resizeSessionList: "Resize session list",
      resizeSessionSidePanel: "Resize session side panel",
      review: "Review",
      running: "Running",
      attentionRequested: "Codex needs confirmation",
      attentionOutputComplete: "Output complete",
      sessionDialog: "Session Dialog",
      sessionDialogStatus: "Session dialog status",
      sessionInlineMaximize: "Maximize session main content",
      sessionInlineRestore: "Restore session terminal",
      sessionInlineTabs: "Session terminal tabs",
      sessionSidePanel: "Session side panel",
      sessionTerminals: "Session terminals",
      newInlineTerminal: "New terminal",
      sessionWorkspace: "Session workspace",
      start: "Start",
      starting: "Starting...",
      temporarySessionDefaultPrompt:
        "Ask Codex to help with the current project without linking an issue.",
      temporarySessionDefaultTitle: "Untitled Session",
      titleField: "Title",
      detailsField: "Details",
      promptField: "Prompt",
      currentModelType: "Current model type",
      addAttachment: "Add attachment",
      removeAttachment: (fileName) => `Remove attachment ${fileName}`,
      attachmentsSavedHint:
        "Attachments are saved but will not be sent with messages yet.",
      selectModel: "Select model",
      thinkMode: "Think mode",
      cancelCurrentTurn: "Cancel current task",
      sendMessage: "Send message",
      messageInput: "Message input",
      messageInputForm: "Message input",
      messagePlaceholder:
        "Type a message. Enter to send, Shift+Enter for a new line",
      contextUsed: (percent) => `${percent}% used`,
      modelLoadFailed: (message) => `Model load failed: ${message}`,
      messageStream: "Agent session message stream",
      emptyMessageStream: "Send a message to start the conversation.",
      thinking: "Thinking...",
      reasoningTitle: "Thinking",
      structuredSessionView: "Agent structured session view",
      readOnlyCompletedIssue: "Completed Issues cannot be run again.",
      permissionCard: "Agent permission approval card",
      sessionListControls: "Session list controls",
      sessionListView: "Session list view",
      sessionMonitor: "Session monitor",
      sessionMonitorClose: "Close",
      sessionMonitorEmpty: "No sessions to show.",
      sessionMonitorList: "Monitored sessions",
      sessionMonitorMenu: "Session monitor menu",
      sessionMonitorUpdatedAt: (updatedAt) => `Updated ${updatedAt}`,
      sessionMonitorView: "View session",
      sessionRunning: "Session is running",
      sessionClosed: "Completed",
      sessionCrashed: "Failed",
      sessionStopped: "Stopped",
      sessionStatus: (statusLabel) => `Session status: ${statusLabel}`,
      issueDetailsTitle: "Issue details",
      fileTree: "Project file tree",
      refreshChanges: "Refresh changes",
      changes: "Changes",
      files: "Files",
      uncommitted: "Uncommitted",
      committed: "Committed",
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
      binaryPreviewUnavailable: "Binary files cannot be previewed.",
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
      todoList: "Todo list",
      contextCompacted: "Context compacted",
      workspaceLabel: "Project terminals workspace",
      contextWindow: "Context window",
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
      settings: "设置",
      terminals: "终端",
      workbench: (projectName) => `${projectName} 工作台`,
    },
    globalSettings: {
      chinese: "中文",
      dark: "深色",
      english: "English",
      enableNotificationFloatingWindow: "启用通知浮窗",
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
      issueMarkedDone: "该 issue 已标记完成",
    },
    richText: {
      bold: "加粗",
      heading: "文本样式",
      headingOne: "一级标题",
      headingTwo: "二级标题",
      normalText: "正文",
      orderedList: "有序列表",
      unorderedList: "无序列表",
    },
    agentNotifications: {
      needsInputTitle: (projectName) => `${projectName} 需要你的输入`,
      permissionFallbackBody: "Agent 正在等待审批或输入。",
      sessionCompletedTitle: (projectName) => `${projectName} 会话已完成`,
      sessionCompletionFallbackSummary: "未捕获最终总结。",
      sessionFailedTitle: (projectName) => `${projectName} 会话失败`,
      sessionRecentMessagesLabel: "最近消息",
      sessionStatusLine: (title, status) =>
        `${title} 已结束，状态为 ${status}。`,
      sessionSummaryLabel: "总结",
      sessionUpdatedTitle: (projectName) => `${projectName} 会话已更新`,
      turnCompletedBody: (sessionId) =>
        `会话 #${sessionId} 已完成最新一轮输出。`,
      turnFailedFallbackBody: "Agent 最新一轮执行失败。",
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
        `确认删除 Agent 配置「${profileName}」吗？`,
      deleteTerminal: (terminalName) => `删除终端「${terminalName}」`,
      editAgent: "编辑 Agent",
      editLabel: "编辑标签",
      editTerminal: (terminalName) => `编辑终端「${terminalName}」`,
      general: "通用",
      globalScope: "全局",
      labelNameRequired: "标签名不能为空。",
      labelNameTooLong: "标签名不能超过 15 个字符。",
      labels: "标签",
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
      agentProfileName: "Agent 配置名称",
      agentTypeLabel: "Agent 类型",
      agentCommand: "Agent 命令",
      skillLoadFailed: "技能加载失败",
      splitterLabel: "调整设置菜单宽度",
      status: "设置状态",
      terminalPath: "终端路径",
      terminalUnavailable: "该终端当前未运行。",
      terminals: "终端",
      projectTerminals: "项目终端",
      terminalsStatus: "终端状态",
      type: "类型",
      workflowSkill: "工作流技能",
      workflowSkillSingle: "工作流技能",
      worktreePath: "工作树路径",
      worktreeSetupAfterCreation: "创建工作树后的初始化命令",
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
      worktreeSetupPlaceholder: "请输入创建工作树后的初始化命令",
    },
    issues: {
      actionsLabel: "Issue 操作",
      addAttachment: "添加附件",
      addLabel: "添加标签",
      attachments: "附件",
      attachmentPreview: "附件预览",
      backlog: "待办",
      back: "返回",
      backReadonly: "返回",
      backEditable: "返回",
      closeAttachmentPreview: "关闭附件预览",
      create: "创建 Issue",
      delete: "删除",
      deleteReadonly: "删除",
      deleteEditable: "删除",
      deleteConfirmMessage: "删除后无法恢复。确认删除当前 Issue 吗？",
      deleteConfirmTitle: "确认删除 Issue",
      deleteConfirmTitleReadonly: "删除 Issue",
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
      noSessionLinked: "暂无关联会话。",
      openLinkedSession: (sessionId) => `打开关联会话 #${sessionId}`,
      openStatusOptions: "打开状态选项",
      previewAttachment: (displayName) => `查看 ${displayName}`,
      prompt: "提示词",
      review: "待验收",
      run: "运行",
      runIssue: (issueId) => `运行 Issue #${issueId}`,
      runStatus: "运行状态",
      save: "保存",
      session: "会话",
      downloadAttachment: (displayName) => `下载 ${displayName}`,
      removeAttachment: (displayName) => `删除 ${displayName}`,
      selectLabels: "选择标签",
      start: "开始",
      starting: "启动中...",
      status: "状态",
      statusLabel: "Issue 状态",
      summaryClose: "关闭 Issue 总结",
      runDialogClose: "关闭运行弹窗",
      commitStrategy: "提交策略",
      confirmCompleteWhileRunning: "当前 Issue 正在执行，是否标记为完成？",
      confirmMoveBackToStatus: (statusLabel) =>
        `确定要回退到 ${statusLabel} 阶段吗？`,
      confirmReturnToBacklog: "确定要退回至 Backlog 阶段吗？",
      confirmRunIssue: "确定要执行吗？",
      confirmTerminateAndReturnToBacklog:
        "当前 Issue 正在执行，是否终止并退回至 Backlog？",
      title: "Issues",
      titleField: "标题",
      titlePlaceholder: "Issue 标题",
      viewSummary: "查看总结",
      workflowSkill: "工作流技能",
      developmentMode: "开发模式",
      currentBranch: "当前分支",
      targetBranch: "目标分支",
      worktree: "工作树",
      dialogStatus: "弹窗状态",
      agentProfile: "Agent 配置",
      agentAutoCommit: "Agent 自动提交",
      completionDirtyTitle: "存在未提交改动",
      completionDirtyMessage:
        "当前会话存在本地未提交改动。是否忽略这些改动并继续完成 Issue？",
      completionIgnoreDirty: "忽略并继续",
      completionHandleManually: "手动处理",
      completionExternalWorktreeTitle: "外部 worktree",
      completionExternalWorktreeMessage: (branch) =>
        `当前会话位于外部 worktree 分支 ${branch}。是否合入并删除该 worktree？`,
      completionMergeAndDelete: "合入并删除",
      completionSkipMerge: "不合入直接完成",
      completionCancel: "取消",
      completionWaitingAgentCommit: "正在等待 Agent 提交。",
      completionNoCommitDetected: "未检测到新的提交。",
      completionGitOperationBlocked: "当前 Git 正在执行操作，请处理后再完成。",
      completionAgentMergeBlocked: "worktree 合入被阻塞，正在交回 Agent 处理。",
    },
    issueSummary: {
      closedAt: "结束时间",
      commitHash: "提交哈希",
      completion: "完成信息",
      diagnostics: "诊断信息",
      failureReason: "失败原因",
      issue: "Issue",
      linkedSession: (sessionId) => `关联会话 #${sessionId}`,
      logPath: "日志路径",
      noCommit: "未产生提交",
      noLinkedSession: "暂无关联会话",
      option: "选项",
      recordedAt: "记录时间",
      result: "结果",
      session: "会话",
      sessionStatus: "会话状态",
      source: "来源",
      startedAt: "开始时间",
      status: "状态",
      unknown: "未知",
      updatedAt: "更新时间",
    },
    agentsFeature: {
      agentSessions: "Agent 会话",
      agentsStatus: "Agents 状态",
      closeCompletionConfirmation: "关闭完成确认",
      closeIssueDetails: "关闭 Issue 详情",
      completionConfirmation: "完成确认",
      confirmDeleteSession: "确认删除该会话？",
      deleteSession: "删除",
      done: "已完成",
      gitSummary: "Git 摘要",
      inProgress: "进行中",
      issueDetails: "Issue 详情",
      issueEyebrow: "Issue",
      issueNotFound: "关联的 Issue 已不存在。",
      noDetailsProvided: "暂无详情。",
      loadingIssue: "正在加载 Issue...",
      loadingSessions: "正在加载会话...",
      markDone: "标记完成",
      markReview: "标记待验收",
      newSession: "新建会话",
      noChangedFiles: "暂无变更文件。",
      noDoneSessions: "暂无已完成的会话。",
      noInProgressSessions: "暂无进行中的会话。",
      noProfilesForAgentType: "未找到可用于当前 Agent 类型的 Agent 配置。",
      noReviewSessions: "暂无待验收的会话。",
      noSessions: "暂无会话。",
      openSessionSidePanel: "打开会话侧边栏",
      openStatusOptions: "打开状态选项",
      openTerminal: "打开终端",
      closeSessionTerminal: (terminalName) => `关闭终端 ${terminalName}`,
      resizeSessionList: "调整会话列表宽度",
      resizeSessionSidePanel: "调整会话侧边栏宽度",
      review: "待验收",
      running: "运行中",
      attentionRequested: "需要确认",
      attentionOutputComplete: "输出完成",
      sessionDialog: "会话弹窗",
      sessionDialogStatus: "会话弹窗状态",
      sessionInlineMaximize: "最大化会话主内容",
      sessionInlineRestore: "恢复会话终端",
      sessionInlineTabs: "会话终端标签",
      sessionSidePanel: "会话侧边栏",
      sessionTerminals: "会话终端",
      newInlineTerminal: "新增终端",
      sessionWorkspace: "会话工作区",
      start: "开始",
      starting: "启动中...",
      temporarySessionDefaultPrompt:
        "请 Codex 在当前项目中协助处理任务，不关联具体 Issue。",
      temporarySessionDefaultTitle: "未命名会话",
      titleField: "标题",
      detailsField: "详情",
      promptField: "提示词",
      currentModelType: "当前模型类型",
      addAttachment: "添加附件",
      removeAttachment: (fileName) => `移除附件 ${fileName}`,
      attachmentsSavedHint: "附件已保存，暂不随消息发送",
      selectModel: "选择模型",
      thinkMode: "思考模式",
      cancelCurrentTurn: "终止当前任务",
      sendMessage: "发送消息",
      messageInput: "消息输入",
      messageInputForm: "消息表单",
      messagePlaceholder: "输入消息，按 Enter 发送，按 Shift+Enter 换行",
      contextUsed: (percent) => `已使用 ${percent}%`,
      modelLoadFailed: (message) => `模型加载失败：${message}`,
      messageStream: "Agent 会话消息流",
      emptyMessageStream: "发送一条消息开始对话。",
      thinking: "正在思考…",
      reasoningTitle: "正在思考…",
      structuredSessionView: "Agent 结构化会话视图",
      readOnlyCompletedIssue: "已完成的 Issue 不能继续运行。",
      permissionCard: "Agent 权限审批卡片",
      sessionListControls: "会话列表控制区",
      sessionListView: "会话列表视图",
      sessionMonitor: "会话监控",
      sessionMonitorClose: "关闭",
      sessionMonitorEmpty: "暂无可展示会话。",
      sessionMonitorList: "监控中的会话",
      sessionMonitorMenu: "会话监控菜单",
      sessionMonitorUpdatedAt: (updatedAt) => `更新于 ${updatedAt}`,
      sessionMonitorView: "查看会话",
      sessionRunning: "会话正在运行",
      sessionClosed: "已完成",
      sessionCrashed: "失败",
      sessionStopped: "已停止",
      sessionStatus: (statusLabel) => `会话状态：${statusLabel}`,
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
      loadingDiff: "正在加载差异...",
      selectFile: "请选择文件。",
      selectChangedFile: "请选择变更文件。",
      fileUnavailable: "文件不可预览",
      diffUnavailable: "差异不可预览",
      binaryPreviewUnavailable: "二进制文件不可预览。",
      largeFilePreviewUnavailable: "文件过大，暂不预览。",
      fileView: (fileName) => `${fileName} 文件`,
      diffView: (fileName) => `${fileName} 差异`,
      closeTab: (label) => `关闭 ${label}`,
      sessionTab: "会话",
      query: "查询",
      mode: "模式",
      noSearchMatches: "没有返回匹配项",
      subSession: (sessionId) => `子会话：${sessionId}`,
      subSessionStarted: "子会话已启动",
      todoList: "待办清单",
      contextCompacted: "上下文已压缩",
      workspaceLabel: "项目终端工作区",
      contextWindow: "上下文窗口",
      toolShell: "命令行",
      toolEdit: "编辑",
      toolWrite: "写入",
      toolRead: "读取",
      toolSearch: "搜索",
      toolTask: "任务",
      toolPlan: "计划",
      toolRunning: "运行中",
      toolFailed: "失败",
      toolCanceled: "已取消",
      exitCode: (exitCode) => `退出码 ${exitCode}`,
      changedFiles: "变更文件",
      changedFilesCount: (count) => `变更文件：${count}`,
      head: (head) => `当前提交：${head}`,
      completionOption: (option) => `完成选项：${option}`,
      unavailableInCurrentScope: "当前范围不可用",
    },
    designSystem: {
      title: "设计系统",
      subtitle: "RedWhisk 界面组件库",
      overview: "概览",
      issuePrototype: "Issue 原型",
      colors: "色彩",
      typography: "字体",
      buttons: "按钮",
      inputs: "输入框",
      cards: "卡片",
      layouts: "布局",
      spacing: "间距",
      borderRadius: "圆角",
      save: "保存",
      cancel: "取消",
      close: "关闭",
      edit: "编辑",
      attach: "附加",
      delete: "删除",
      newIssue: "新建 Issue",
      action: "操作",
      primary: "主要",
      confirm: "确认",
      disabled: "已禁用",
      check: "检查",
      closeButton: "关闭",
      enterIssueTitle: "输入 Issue 标题",
      cannotEdit: "无法编辑此项",
      noIssues: "暂无 Issues",
      myPage: "我的页面",
      subtitleHere: "副标题在这里",
      pageContent: "页面内容在这里",
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
