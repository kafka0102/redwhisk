import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileBraces,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  SquareCode,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NodeRendererProps } from "react-arborist";

import { Input } from "../../components/ui/input";
import { useI18n } from "../i18n/i18n";
import {
  getChangeKindStatusClassName,
  getChangeKindStatusLabel,
} from "./workspace-change-status";
import type {
  WorkspaceChangeKind,
  WorkspaceFileTreeNode,
} from "./workspace-commands";

export interface FileTreeRowProps extends NodeRendererProps<WorkspaceFileTreeNode> {
  changedFileKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  directoryKinds?: ReadonlyMap<string, WorkspaceChangeKind>;
  /** 是否为当前右键菜单的目标行；为 true 时保持悬停同款底色。 */
  isMenuTarget: boolean;
  onOpenFile: (file: WorkspaceFileTreeNode) => void;
  onContextMenuNode: (
    node: WorkspaceFileTreeNode,
    x: number,
    y: number,
  ) => void;
}

export function FileTreeRow({
  node,
  changedFileKinds,
  directoryKinds,
  isMenuTarget,
  onOpenFile,
  onContextMenuNode,
  style,
}: FileTreeRowProps) {
  const treeDepthStyle = {
    ...style,
    "--tree-depth": node.level,
  } as CSSProperties;

  if (node.data.kind === "directory") {
    const directoryKind = directoryKinds?.get(node.data.path);
    return (
      <button
        aria-expanded={node.isOpen}
        className={fileTreeRowClassName("session-file-tree__folder", {
          isIgnored: node.data.isIgnored,
          isMenuTarget,
        })}
        style={treeDepthStyle}
        type="button"
        onClick={() => node.toggle()}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenuNode(node.data, event.clientX, event.clientY);
        }}
      >
        {node.isOpen ? (
          <ChevronDown
            aria-hidden="true"
            className="session-file-tree__chevron"
            size={13}
            strokeWidth={2}
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="session-file-tree__chevron"
            size={13}
            strokeWidth={2}
          />
        )}
        <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
        <span className={fileTreeNameClassName(directoryKind)}>
          {node.data.name}
        </span>
      </button>
    );
  }

  const fileKind = changedFileKinds?.get(node.data.path);
  return (
    <button
      className={fileTreeRowClassName("session-file-tree__row", {
        isIgnored: node.data.isIgnored,
        isMenuTarget,
      })}
      style={treeDepthStyle}
      type="button"
      onClick={() => onOpenFile(node.data)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenuNode(node.data, event.clientX, event.clientY);
      }}
    >
      <span
        aria-hidden="true"
        className="session-file-tree__chevron session-file-tree__chevron--placeholder"
      />
      <FileTypeIcon fileName={node.data.name} />
      <span className={fileTreeNameClassName(fileKind)}>{node.data.name}</span>
      {fileKind !== undefined ? <FileTreeStatusBadge kind={fileKind} /> : null}
    </button>
  );
}

export interface FileTreeDraftRowProps extends NodeRendererProps<WorkspaceFileTreeNode> {
  /** 最近一次创建失败的提示；非 null 时草稿行标记为非法输入。 */
  errorMessage: string | null;
  /** 每次失败自增：同一错误重复出现时也要重新聚焦并选中已输入内容。 */
  errorRevision: number;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

/**
 * 行内新建草稿行（ADR 0040）：文件夹 / 文件图标 + 输入框，名字由行自身持有。
 *
 * Escape、空值失焦、空值回车 = 取消；非空失焦、非空回车 = 提交。提交失败时输入行
 * 与已输入内容保持在原位并重新选中，便于就地改名。
 */
export function FileTreeDraftRow({
  node,
  errorMessage,
  errorRevision,
  onCancel,
  onSubmit,
  style,
}: FileTreeDraftRowProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const isDirectory = node.data.kind === "directory";
  const label = isDirectory
    ? t("agentsFeature.newFolder")
    : t("agentsFeature.newFile");
  const treeDepthStyle = {
    ...style,
    "--tree-depth": node.level,
  } as CSSProperties;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (errorRevision === 0) return;
    isSubmittingRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [errorRevision]);

  const submit = () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    onSubmit(name);
  };

  return (
    <div className="session-file-tree__row" style={treeDepthStyle}>
      <span
        aria-hidden="true"
        className="session-file-tree__chevron session-file-tree__chevron--placeholder"
      />
      {isDirectory ? (
        <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
      ) : (
        <FileTypeIcon fileName={name} />
      )}
      <Input
        ref={inputRef}
        aria-invalid={errorMessage !== null}
        aria-label={label}
        className="session-file-tree__draft-input"
        title={errorMessage ?? undefined}
        value={name}
        onBlur={() => {
          if (name.trim() === "") {
            onCancel();
            return;
          }
          submit();
        }}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
    </div>
  );
}

/** 文件/目录行 class：基类 + 可选忽略态 + 可选右键菜单目标态。 */
function fileTreeRowClassName(
  base: "session-file-tree__folder" | "session-file-tree__row",
  { isIgnored, isMenuTarget }: { isIgnored: boolean; isMenuTarget: boolean },
): string {
  return [
    base,
    isIgnored ? "session-file-tree__row--ignored" : null,
    isMenuTarget ? `${base}--menu-target` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
}

/** 文件/目录名 class：基类 + 可选变更状态色。 */
function fileTreeNameClassName(kind: WorkspaceChangeKind | undefined): string {
  if (kind === undefined) {
    return "session-file-tree__name";
  }
  return `session-file-tree__name ${getChangeKindStatusClassName(kind)}`;
}

/** 文件树行尾的变更状态徽标：复用变更视图的 A/M/D 字样与配色（绿 A、金黄 M、红 D）。 */
export function FileTreeStatusBadge({ kind }: { kind: WorkspaceChangeKind }) {
  return (
    <span
      aria-label={getChangeKindStatusLabel(kind)}
      className={`session-file-tree__status ${getChangeKindStatusClassName(kind)}`}
    >
      {getChangeKindStatusLabel(kind)}
    </span>
  );
}

export function FileTypeIcon({ fileName }: { fileName: string }) {
  const extension = getFileExtension(fileName);
  const className = `session-file-tree__icon session-file-tree__icon--${extension || "plain"}`;

  switch (extension) {
    case "css":
    case "scss":
    case "sass":
    case "less":
      return <SquareCode aria-hidden="true" className={className} size={15} />;
    case "html":
    case "vue":
    case "svelte":
      return <FileCode2 aria-hidden="true" className={className} size={15} />;
    case "json":
    case "jsonc":
    case "lock":
      return <FileJson2 aria-hidden="true" className={className} size={15} />;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "go":
    case "py":
    case "java":
    case "kt":
    case "swift":
      return <FileBraces aria-hidden="true" className={className} size={15} />;
    case "md":
    case "mdx":
    case "txt":
      return <FileText aria-hidden="true" className={className} size={15} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return <FileImage aria-hidden="true" className={className} size={15} />;
    case "zip":
    case "gz":
    case "tar":
      return <FileArchive aria-hidden="true" className={className} size={15} />;
    case "sh":
    case "zsh":
    case "bash":
      return (
        <FileTerminal aria-hidden="true" className={className} size={15} />
      );
    case "toml":
    case "yaml":
    case "yml":
    case "env":
      return <FileCog aria-hidden="true" className={className} size={15} />;
    case "":
      return <FileText aria-hidden="true" className={className} size={15} />;
    default:
      return <FileType aria-hidden="true" className={className} size={15} />;
  }
}

function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1) : "";
}
