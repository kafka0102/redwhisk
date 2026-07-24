import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  WholeWord,
} from "lucide-react";
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Input } from "../../components/ui/input";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { FileTypeIcon } from "../../shared/workspace/file-tree-panel";
import {
  searchProjectWorktreeContent,
  type WorkspaceContentSearchFileGroup,
  type WorkspaceContentSearchMatch,
  type WorkspaceFileTreeNode,
} from "../../shared/workspace/workspace-commands";
import { CodeSearchFilterTags } from "./code-search-filter-tags";
import type { CodeContentSearchState } from "./code-search-state";

export interface CodeSearchPanelProps {
  state: CodeContentSearchState;
  onChange: (next: CodeContentSearchState) => void;
  projectId: number;
  workspacePath: string | null;
  /** 当前代码根文件树 nodes；后缀下拉由其聚合，随 tree/signature 更新。 */
  fileTree: readonly WorkspaceFileTreeNode[];
  onOpenMatch: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
  /** 递增以请求聚焦查询输入；有文本时全选。 */
  queryFocusRequest?: number;
}

/**
 * 代码搜索侧栏：查询框、匹配选项、包含/排除 Tag、回车搜索与分组结果。
 * 状态由上层缓存，便于与文件树互斥切换时保留输入与结果。
 */
export function CodeSearchPanel({
  state,
  onChange,
  projectId,
  workspacePath,
  fileTree,
  onOpenMatch,
  queryFocusRequest = 0,
}: CodeSearchPanelProps) {
  const { messages, t } = useI18n();
  const copy = messages.agentsFeature;
  const queryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (queryFocusRequest <= 0) {
      return;
    }
    const input = queryInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    if (input.value.length > 0) {
      input.select();
    }
  }, [queryFocusRequest]);

  const patch = (partial: Partial<CodeContentSearchState>) => {
    onChange({ ...state, ...partial });
  };

  const onQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    patch({ query: event.target.value });
  };

  const runSearch = async () => {
    const query = state.query.trim();
    if (!query) {
      patch({
        collapsedFiles: {},
        errorMessage: null,
        isSearching: false,
        results: null,
      });
      return;
    }
    if (!workspacePath) {
      patch({
        errorMessage: copy.contentSearchError,
        isSearching: false,
        results: null,
      });
      return;
    }

    patch({ errorMessage: null, isSearching: true });
    try {
      const results = await searchProjectWorktreeContent({
        projectId,
        workspacePath,
        query,
        matchCase: state.matchCase,
        matchWholeWord: state.matchWholeWord,
        useRegex: state.useRegex,
        include: state.includeTags,
        exclude: state.excludeTags,
      });
      patch({
        collapsedFiles: {},
        errorMessage: null,
        isSearching: false,
        results,
      });
    } catch (error) {
      patch({
        errorMessage: getCommandErrorMessage(error, t),
        isSearching: false,
        results: null,
      });
    }
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void runSearch();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const toggleFile = (filePath: string) => {
    const collapsed = Boolean(state.collapsedFiles[filePath]);
    patch({
      collapsedFiles: {
        ...state.collapsedFiles,
        [filePath]: !collapsed,
      },
    });
  };

  return (
    <div
      className="code-workspace__search-panel"
      aria-label={copy.contentSearchPanel}
    >
      <form className="code-workspace__search-form" onSubmit={onSubmit}>
        <div className="code-workspace__search-query-row">
          <Input
            ref={queryInputRef}
            className="code-workspace__search-query"
            type="search"
            value={state.query}
            placeholder={copy.contentSearchQueryPlaceholder}
            aria-label={copy.contentSearchQuery}
            onChange={onQueryChange}
            onKeyDown={onQueryKeyDown}
          />
          <div
            className="code-workspace__search-match-options"
            role="group"
            aria-label={copy.contentSearchMatchOptions}
          >
            <button
              type="button"
              className="code-workspace__search-option"
              aria-label={copy.contentSearchMatchCase}
              aria-pressed={state.matchCase}
              onClick={() => patch({ matchCase: !state.matchCase })}
            >
              <CaseSensitive aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="code-workspace__search-option"
              aria-label={copy.contentSearchMatchWholeWord}
              aria-pressed={state.matchWholeWord}
              onClick={() => patch({ matchWholeWord: !state.matchWholeWord })}
            >
              <WholeWord aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="code-workspace__search-option"
              aria-label={copy.contentSearchUseRegex}
              aria-pressed={state.useRegex}
              onClick={() => patch({ useRegex: !state.useRegex })}
            >
              <Regex aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <CodeSearchFilterTags
          tags={state.includeTags}
          onChange={(includeTags) => patch({ includeTags })}
          fileTree={fileTree}
          label={copy.contentSearchFilesToInclude}
          placeholder={copy.contentSearchFilesToIncludePlaceholder}
          removeTagLabel={copy.contentSearchRemoveFilterTag}
          suffixPickerLabel={copy.contentSearchSuffixPicker}
          suffixOptionLabel={copy.contentSearchSuffixOption}
          noSuffixesLabel={copy.contentSearchNoSuffixes}
        />

        <CodeSearchFilterTags
          tags={state.excludeTags}
          onChange={(excludeTags) => patch({ excludeTags })}
          fileTree={fileTree}
          label={copy.contentSearchFilesToExclude}
          placeholder={copy.contentSearchFilesToExcludePlaceholder}
          removeTagLabel={copy.contentSearchRemoveFilterTag}
          suffixPickerLabel={copy.contentSearchSuffixPicker}
          suffixOptionLabel={copy.contentSearchSuffixOption}
          noSuffixesLabel={copy.contentSearchNoSuffixes}
        />
      </form>

      <div
        className="code-workspace__search-results"
        aria-label={copy.contentSearchResults}
      >
        <SearchResultsBody
          state={state}
          copy={copy}
          onToggleFile={toggleFile}
          onOpenMatch={onOpenMatch}
        />
      </div>
    </div>
  );
}

function SearchResultsBody({
  state,
  copy,
  onToggleFile,
  onOpenMatch,
}: {
  state: CodeContentSearchState;
  copy: ReturnType<typeof useI18n>["messages"]["agentsFeature"];
  onToggleFile: (filePath: string) => void;
  onOpenMatch: CodeSearchPanelProps["onOpenMatch"];
}) {
  if (state.isSearching) {
    return (
      <p className="code-workspace__search-results-empty">
        {copy.contentSearchSearching}
      </p>
    );
  }

  if (state.errorMessage) {
    return (
      <p className="code-workspace__search-results-error" role="alert">
        {state.errorMessage}
      </p>
    );
  }

  if (!state.results) {
    return (
      <p className="code-workspace__search-results-empty">
        {copy.contentSearchEmptyResults}
      </p>
    );
  }

  if (state.results.files.length === 0) {
    return (
      <p className="code-workspace__search-results-empty">
        {copy.contentSearchNoMatches}
      </p>
    );
  }

  const statsText = state.results.truncated
    ? copy.contentSearchStatsTruncated(
        state.results.fileCount,
        state.results.matchCount,
      )
    : copy.contentSearchStats(
        state.results.fileCount,
        state.results.matchCount,
      );

  return (
    <>
      <p className="code-workspace__search-stats">{statsText}</p>
      <ul className="code-workspace__search-file-list">
        {state.results.files.map((group) => (
          <SearchFileGroup
            key={group.filePath}
            group={group}
            collapsed={Boolean(state.collapsedFiles[group.filePath])}
            copy={copy}
            onToggle={() => onToggleFile(group.filePath)}
            onOpenMatch={onOpenMatch}
          />
        ))}
      </ul>
    </>
  );
}

function SearchFileGroup({
  group,
  collapsed,
  copy,
  onToggle,
  onOpenMatch,
}: {
  group: WorkspaceContentSearchFileGroup;
  collapsed: boolean;
  copy: ReturnType<typeof useI18n>["messages"]["agentsFeature"];
  onToggle: () => void;
  onOpenMatch: CodeSearchPanelProps["onOpenMatch"];
}) {
  return (
    <li className="code-workspace__search-file-group">
      <button
        type="button"
        className="code-workspace__search-file-header"
        aria-expanded={!collapsed}
        aria-label={copy.contentSearchToggleFile(group.fileName)}
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight
            aria-hidden="true"
            className="code-workspace__search-file-chevron"
            size={14}
            strokeWidth={1.8}
          />
        ) : (
          <ChevronDown
            aria-hidden="true"
            className="code-workspace__search-file-chevron"
            size={14}
            strokeWidth={1.8}
          />
        )}
        <FileTypeIcon fileName={group.fileName} />
        <span className="code-workspace__search-file-name">
          {group.fileName}
        </span>
        <span
          className="code-workspace__search-file-path"
          title={group.filePath}
        >
          {group.filePath}
        </span>
        <span className="code-workspace__search-file-count">
          {copy.contentSearchMatchCount(group.matchCount)}
        </span>
      </button>
      {!collapsed ? (
        <ul className="code-workspace__search-match-list">
          {group.matches.map((match) => (
            <SearchMatchRow
              key={`${group.filePath}:${match.lineNumber}:${match.matchStart ?? 0}`}
              group={group}
              match={match}
              openLabel={copy.contentSearchOpenMatch(
                group.fileName,
                match.lineNumber,
              )}
              onOpenMatch={onOpenMatch}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SearchMatchRow({
  group,
  match,
  openLabel,
  onOpenMatch,
}: {
  group: WorkspaceContentSearchFileGroup;
  match: WorkspaceContentSearchMatch;
  openLabel: string;
  onOpenMatch: CodeSearchPanelProps["onOpenMatch"];
}) {
  return (
    <li>
      <button
        type="button"
        className="code-workspace__search-match-row"
        aria-label={openLabel}
        onClick={() =>
          onOpenMatch({
            fileName: group.fileName,
            filePath: group.filePath,
            lineNumber: match.lineNumber,
          })
        }
      >
        <span className="code-workspace__search-match-line">
          {match.lineNumber}
        </span>
        <span className="code-workspace__search-match-text">
          {match.lineText.trim()}
        </span>
      </button>
    </li>
  );
}
