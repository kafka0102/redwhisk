import type { SessionWorkspaceFile } from "./session-workspace-types";

export interface MockChangedFile extends SessionWorkspaceFile {
  added: string;
  deleted: string;
  isNew: boolean;
}

export interface MockTreeNode extends SessionWorkspaceFile {
  depth: number;
  extension: "css" | "rs" | "ts" | "tsx" | "vue";
}

export const MOCK_CHANGED_FILES: MockChangedFile[] = [
  {
    fileName: "agents-activity.tsx",
    filePath: "src/features/agents/agents-activity.tsx",
    added: "+164",
    deleted: "-22",
    isNew: false,
  },
  {
    fileName: "agents-session-pane.tsx",
    filePath: "src/features/agents/agents-session-pane.tsx",
    added: "+88",
    deleted: "-31",
    isNew: false,
  },
  {
    fileName: "session-side-panel.tsx",
    filePath: "src/features/agents/session-side-panel.tsx",
    added: "+241",
    deleted: "-0",
    isNew: true,
  },
  {
    fileName: "session-workspace-tabs.tsx",
    filePath: "src/features/agents/session-workspace-tabs.tsx",
    added: "+119",
    deleted: "-0",
    isNew: true,
  },
  {
    fileName: "app.css",
    filePath: "src/app/app.css",
    added: "+196",
    deleted: "-47",
    isNew: false,
  },
  {
    fileName: "agents-activity.test.tsx",
    filePath: "src/features/agents/agents-activity.test.tsx",
    added: "+72",
    deleted: "-12",
    isNew: false,
  },
];

export const MOCK_FILE_TREE: MockTreeNode[] = [
  {
    fileName: "agents-activity.tsx",
    filePath: "src/features/agents/agents-activity.tsx",
    depth: 3,
    extension: "tsx",
  },
  {
    fileName: "agents-session-pane.tsx",
    filePath: "src/features/agents/agents-session-pane.tsx",
    depth: 3,
    extension: "tsx",
  },
  {
    fileName: "session-side-panel.tsx",
    filePath: "src/features/agents/session-side-panel.tsx",
    depth: 3,
    extension: "tsx",
  },
  {
    fileName: "session-workspace-tabs.tsx",
    filePath: "src/features/agents/session-workspace-tabs.tsx",
    depth: 3,
    extension: "tsx",
  },
  {
    fileName: "app.css",
    filePath: "src/app/app.css",
    depth: 1,
    extension: "css",
  },
  {
    fileName: "mod.rs",
    filePath: "src-tauri/src/agent/mod.rs",
    depth: 3,
    extension: "rs",
  },
  {
    fileName: "mock-vue-file.vue",
    filePath: "src/features/agents/mock-vue-file.vue",
    depth: 3,
    extension: "vue",
  },
];
