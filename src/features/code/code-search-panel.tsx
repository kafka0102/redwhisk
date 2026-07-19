import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  WholeWord,
} from "lucide-react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";

import { Input } from "../../components/ui/input";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { FileTypeIcon } from "../../shared/workspace/file-tree-panel";
import {
  searchProjectWorktreeContent,
  type WorkspaceContentSearchFileGroup,
  type WorkspaceContentSearchMatch,
} from "../../shared/workspace/workspace-commands";
import type { CodeContentSearchState } from "./code-search-state";

export interface CodeSearchPanelProps {
  state: CodeContentSearchState;
  onChange: (next: CodeContentSearchState) => void;
  projectId: number;
  workspacePath: string | null;
  onOpenMatch: (match: {
    fileName: string;
    filePath: string;
    lineNumber: number;
  }) => void;
}

/**
 * 代码搜索侧栏：查询框、匹配选项、包含/排除行、回车搜索与分组结果。
 * 状态由上层缓存，便于与文件树互斥切换时保留输入与结果。
 */
export function CodeSearchPanel({
  state,
  onChange,
  projectId,
  workspacePath,
  onOpenMatch,
}: CodeSearchPanelProps) {
  const { messages, t } = useI18n();
  const copy = messages.agentsFeature;

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
        include: parseFilterTags(state.includeText),
        exclude: parseFilterTags(state.excludeText),
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

        <div className="code-workspace__search-filter-row">
          <label className="code-workspace__search-filter-label">
            <span>{copy.contentSearchFilesToInclude}</span>
            <Input
              className="code-workspace__search-filter-input"
              type="text"
              value={state.includeText}
              placeholder={copy.contentSearchFilesToIncludePlaceholder}
              aria-label={copy.contentSearchFilesToInclude}
              onChange={(event) => patch({ includeText: event.target.value })}
            />
          </label>
        </div>

        <div className="code-workspace__search-filter-row">
          <label className="code-workspace__search-filter-label">
            <span>{copy.contentSearchFilesToExclude}</span>
            <Input
              className="code-workspace__search-filter-input"
              type="text"
              value={state.excludeText}
              placeholder={copy.contentSearchFilesToExcludePlaceholder}
              aria-label={copy.contentSearchFilesToExclude}
              onChange={(event) => patch({ excludeText: event.target.value })}
            />
          </label>
        </div>
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

function parseFilterTags(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
