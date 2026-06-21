import { Check, ChevronDown, Circle, RefreshCw } from "lucide-react";
import { useState } from "react";

import { MOCK_CHANGED_FILES, type MockChangedFile } from "./session-mock-files";

type ChangeFilter = "committed" | "uncommitted";

interface SessionChangesPanelProps {
  onOpenChangedFile: (file: MockChangedFile) => void;
}

export function SessionChangesPanel({
  onOpenChangedFile,
}: SessionChangesPanelProps) {
  const [filter, setFilter] = useState<ChangeFilter>("uncommitted");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const filterLabel = filter === "uncommitted" ? "未提交" : "已提交";

  return (
    <div className="session-changes-panel">
      <div className="session-side-panel__filter-row">
        <div className="session-change-filter">
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
        >
          <RefreshCw aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
      </div>
      {filter === "uncommitted" ? (
        <div className="session-changes-panel__list">
          {MOCK_CHANGED_FILES.map((file) => (
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
  file: MockChangedFile;
  onOpenChangedFile: (file: MockChangedFile) => void;
}

function ChangedFileRow({ file, onOpenChangedFile }: ChangedFileRowProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  return (
    <button
      className="session-change-row"
      type="button"
      onBlur={() => setIsTooltipVisible(false)}
      onClick={() => onOpenChangedFile(file)}
      onFocus={() => setIsTooltipVisible(true)}
      onMouseEnter={() => setIsTooltipVisible(true)}
      onMouseLeave={() => setIsTooltipVisible(false)}
    >
      <span className="session-change-row__name">
        {file.fileName}
        <span className="session-change-row__path">
          {getParentPath(file.filePath)}
        </span>
      </span>
      <span className="session-change-row__actions">
        {file.isNew ? (
          <span className="session-change-row__new">新增</span>
        ) : null}
        <span className="session-change-row__stats">
          <span className="session-change-row__added">{file.added}</span>
          <span className="session-change-row__deleted">{file.deleted}</span>
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
