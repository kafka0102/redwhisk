import type { WorkspaceContentSearchResponse } from "../../shared/workspace/workspace-commands";

/** 代码 Activity 左侧栏模式：文件树与内容搜索互斥。 */
export type CodeSidebarMode = "fileTree" | "search";

/** 代码搜索侧栏本地状态（会话内缓存，不跨应用重启）。 */
export interface CodeContentSearchState {
  collapsedFiles: Record<string, boolean>;
  errorMessage: string | null;
  /** 排除文件 glob tags（OR；与 include 同时命中时 exclude 优先）。 */
  excludeTags: string[];
  /** 包含文件 glob tags（OR；空 = 全部合格文件）。 */
  includeTags: string[];
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
  excludeTags: [],
  includeTags: [],
  isSearching: false,
  matchCase: false,
  matchWholeWord: false,
  query: "",
  results: null,
  useRegex: false,
};
