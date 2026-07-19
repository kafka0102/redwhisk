/** 代码 Activity 左侧栏模式：文件树与内容搜索互斥。 */
export type CodeSidebarMode = "fileTree" | "search";

/** 代码搜索侧栏本地状态（会话内缓存，不跨应用重启）。 */
export interface CodeContentSearchState {
  excludeText: string;
  includeText: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  query: string;
  useRegex: boolean;
}

export const DEFAULT_CODE_CONTENT_SEARCH_STATE: CodeContentSearchState = {
  excludeText: "",
  includeText: "",
  matchCase: false,
  matchWholeWord: false,
  query: "",
  useRegex: false,
};
