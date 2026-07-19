import type { WorkspaceContentSearchResponse } from "../../shared/workspace/workspace-commands";

/** 代码 Activity 左侧栏模式：文件树与内容搜索互斥。 */
export type CodeSidebarMode = "fileTree" | "search";

/** 代码搜索侧栏本地状态（会话内缓存，不跨应用重启）。 */
export interface CodeContentSearchState {
  collapsedFiles: Record<string, boolean>;
  errorMessage: string | null;
  excludeText: string;
  includeText: string;
  isSearching: boolean;
  matchCase: boolean;
  matchWholeWord: boolean;
  query: string;
  results: WorkspaceContentSearchResponse | null;
  useRegex: boolean;
}

export const DEFAULT_CODE_CONTENT_SEARCH_STATE: CodeContentSearchState = {
  collapsedFiles: {},
  errorMessage: null,
  excludeText: "",
  includeText: "",
  isSearching: false,
  matchCase: false,
  matchWholeWord: false,
  query: "",
  results: null,
  useRegex: false,
};
