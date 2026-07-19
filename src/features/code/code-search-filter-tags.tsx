import { ChevronDown, X } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useMemo,
  useState,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import type { WorkspaceFileTreeNode } from "../../shared/workspace/workspace-commands";
import {
  appendFilterTags,
  collectTopFileSuffixes,
  parseFilterTagInput,
  suffixToIncludeGlob,
} from "./code-search-suffixes";

export interface CodeSearchFilterTagsProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  fileTree: readonly WorkspaceFileTreeNode[];
  label: string;
  placeholder: string;
  removeTagLabel: (tag: string) => string;
  suffixPickerLabel: string;
  suffixOptionLabel: (suffix: string) => string;
  noSuffixesLabel: string;
}

/**
 * 包含/排除文件 Tag 输入：回车/逗号添加、删除 chip，右侧下拉选常见后缀写入 glob。
 * 改 tag 本身不触发搜索（由上层决定何时提交 command）。
 */
export function CodeSearchFilterTags({
  tags,
  onChange,
  fileTree,
  label,
  placeholder,
  removeTagLabel,
  suffixPickerLabel,
  suffixOptionLabel,
  noSuffixesLabel,
}: CodeSearchFilterTagsProps) {
  const [draft, setDraft] = useState("");
  const topSuffixes = useMemo(
    () => collectTopFileSuffixes(fileTree),
    [fileTree],
  );

  const commitDraft = () => {
    const next = parseFilterTagInput(draft);
    if (next.length === 0) {
      setDraft("");
      return;
    }
    onChange(appendFilterTags(tags, next));
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (
      !text ||
      (!text.includes(",") && !text.includes("，") && !text.includes("\n"))
    ) {
      return;
    }
    event.preventDefault();
    const combined = `${draft}${text}`;
    const next = parseFilterTagInput(combined);
    if (next.length === 0) return;
    onChange(appendFilterTags(tags, next));
    setDraft("");
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag));
  };

  const addSuffix = (suffix: string) => {
    onChange(appendFilterTags(tags, [suffixToIncludeGlob(suffix)]));
  };

  return (
    <div className="code-workspace__search-filter-row">
      <div className="code-workspace__search-filter-label">
        <span>{label}</span>
        <div className="code-workspace__search-filter-field">
          <div
            className="code-workspace__search-filter-tags"
            role="group"
            aria-label={label}
          >
            {tags.map((tag) => (
              <span key={tag} className="code-workspace__search-filter-tag">
                <span className="code-workspace__search-filter-tag-text">
                  {tag}
                </span>
                <button
                  type="button"
                  className="code-workspace__search-filter-tag-remove"
                  aria-label={removeTagLabel(tag)}
                  onClick={() => removeTag(tag)}
                >
                  <X aria-hidden="true" size={11} strokeWidth={2} />
                </button>
              </span>
            ))}
            <input
              className="code-workspace__search-filter-tag-input"
              type="text"
              value={draft}
              placeholder={tags.length === 0 ? placeholder : undefined}
              aria-label={label}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={commitDraft}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="code-workspace__search-filter-suffix-trigger"
              aria-label={suffixPickerLabel}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="code-workspace__search-filter-suffix-menu"
            >
              {topSuffixes.length === 0 ? (
                <div className="code-workspace__search-filter-suffix-empty">
                  {noSuffixesLabel}
                </div>
              ) : (
                topSuffixes.map((suffix) => (
                  <DropdownMenuItem
                    key={suffix}
                    onClick={() => addSuffix(suffix)}
                  >
                    {suffixOptionLabel(suffix)}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
