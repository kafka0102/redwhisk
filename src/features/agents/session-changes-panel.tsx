import { Check, ChevronDown, Circle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  WorkspaceChangedFile,
  WorkspaceChangeKind,
} from "./session-workspace-commands";

type ChangeFilter = "committed" | "uncommitted";

interface SessionChangesPanelProps {
  changes: WorkspaceChangedFile[];
  errorMessage: string | null;
  isLoading: boolean;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
  onRefreshChanges: () => void;
}

export function SessionChangesPanel({
  changes,
  errorMessage,
  isLoading,
  onOpenChangedFile,
  onRefreshChanges,
}: SessionChangesPanelProps) {
  const [filter, setFilter] = useState<ChangeFilter>("uncommitted");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const filterLabel = filter === "uncommitted" ? "未提交" : "已提交";

  useEffect(() => {
    if (!isFilterOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        filterRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsFilterOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [isFilterOpen]);

  return (
    <div className="session-changes-panel">
      <div className="session-side-panel__filter-row">
        <div className="session-change-filter" ref={filterRef}>
          <button
            aria-expanded={isFilterOpen}
            aria-haspopup="menu"
            className="session-change-filter__trigger"
            type="button"
            onClick={() => setIsFilterOpen((current) => !current)}
          >
            {filter === "uncommitted" ? (
              <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
            ) : (
              <Check aria-hidden="true" size={13} strokeWidth={1.8} />
            )}
            <span>{filterLabel}</span>
            <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
          </button>
          {isFilterOpen ? (
            <div className="session-change-filter__menu" role="menu">
              <button
                aria-current={filter === "uncommitted" ? "true" : undefined}
                className="session-change-filter__item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setFilter("uncommitted");
                  setIsFilterOpen(false);
                }}
              >
                <Circle aria-hidden="true" size={13} strokeWidth={1.8} />
                未提交
              </button>
              <button
                aria-current={filter === "committed" ? "true" : undefined}
                className="session-change-filter__item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setFilter("committed");
                  setIsFilterOpen(false);
                }}
              >
                <Check aria-hidden="true" size={13} strokeWidth={1.8} />
                已提交
              </button>
            </div>
          ) : null}
        </div>
        <button
          aria-label="刷新变更"
          className="session-side-panel__refresh"
          type="button"
          onClick={onRefreshChanges}
        >
          <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
      </div>
      {filter === "uncommitted" ? (
        <div className="session-changes-panel__list">
          {errorMessage ? (
            <p className="session-side-panel__empty">{errorMessage}</p>
          ) : null}
          {changes.length === 0 && !errorMessage ? (
            <p className="session-side-panel__empty">
              {isLoading ? "正在加载变更..." : "暂无未提交变更。"}
            </p>
          ) : null}
          {changes.map((file) => (
            <ChangedFileRow
              key={file.filePath}
              file={file}
              onOpenChangedFile={onOpenChangedFile}
            />
          ))}
        </div>
      ) : (
        <p className="session-side-panel__empty">已提交变更暂未实现。</p>
      )}
    </div>
  );
}

interface ChangedFileRowProps {
  file: WorkspaceChangedFile;
  onOpenChangedFile: (file: WorkspaceChangedFile) => void;
}

function ChangedFileRow({ file, onOpenChangedFile }: ChangedFileRowProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const kindLabel = formatChangeKindLabel(file.kind);

  return (
    <button
      className={`session-change-row${file.kind === "deleted" ? " session-change-row--deleted" : ""}`}
      type="button"
      onBlur={() => setIsTooltipVisible(false)}
      onClick={() => onOpenChangedFile(file)}
      onFocus={() => setIsTooltipVisible(true)}
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      <span className="session-change-row__name">
        <span>{file.fileName}</span>
        <span className="session-change-row__path">
          {getParentPath(file.filePath)}
        </span>
      </span>
      <span className="session-change-row__actions">
        <span className="session-change-row__label">{kindLabel}</span>
        <span className="session-change-row__stats">
          <span className="session-change-row__added">{`+${file.additions}`}</span>
          <span className="session-change-row__deleted">{`-${file.deletions}`}</span>
        </span>
      </span>
      {isTooltipVisible ? (
        <span className="session-change-row__tooltip" role="tooltip">
          {file.filePath}
        </span>
      ) : null}
    </button>
  );
}

function getParentPath(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf("/");
  return lastSlashIndex >= 0 ? filePath.slice(0, lastSlashIndex) : "";
}

function formatChangeKindLabel(kind: WorkspaceChangeKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    case "copied":
      return "复制";
    case "binary":
      return "二进制";
    case "modified":
      return "修改";
  }
}
