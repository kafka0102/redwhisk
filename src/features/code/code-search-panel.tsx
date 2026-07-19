import { CaseSensitive, Regex, WholeWord } from "lucide-react";
import type { ChangeEvent } from "react";

import { Input } from "../../components/ui/input";
import { useI18n } from "../../shared/i18n/i18n";
import type { CodeContentSearchState } from "./code-search-state";

export interface CodeSearchPanelProps {
  state: CodeContentSearchState;
  onChange: (next: CodeContentSearchState) => void;
}

/**
 * 代码搜索侧栏骨架：查询框、匹配选项、包含/排除行与空结果区。
 * 本组件不发起真实搜索；状态由上层缓存，便于与文件树互斥切换时保留输入。
 */
export function CodeSearchPanel({ state, onChange }: CodeSearchPanelProps) {
  const { messages } = useI18n();
  const copy = messages.agentsFeature;

  const patch = (partial: Partial<CodeContentSearchState>) => {
    onChange({ ...state, ...partial });
  };

  const onQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    patch({ query: event.target.value });
  };

  return (
    <div
      className="code-workspace__search-panel"
      aria-label={copy.contentSearchPanel}
    >
      <div className="code-workspace__search-query-row">
        <Input
          className="code-workspace__search-query"
          type="search"
          value={state.query}
          placeholder={copy.contentSearchQueryPlaceholder}
          aria-label={copy.contentSearchQuery}
          onChange={onQueryChange}
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

      <div
        className="code-workspace__search-results"
        aria-label={copy.contentSearchResults}
      >
        <p className="code-workspace__search-results-empty">
          {copy.contentSearchEmptyResults}
        </p>
      </div>
    </div>
  );
}
