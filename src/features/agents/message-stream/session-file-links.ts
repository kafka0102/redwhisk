// 会话消息流里的「本地文件链接」能力与路径解析。
//
// 只做「相对化」：把 Markdown 链接目标里能确定指向工作区内文件的部分收成
// 工作区相对路径，交给 `SessionFileViewer` 所在侧栏（`openFilePath`）。
// 与 Codex `local_links.rs` 同口径：不碰文件系统、不解析符号链接、不折叠 `.` / `..`；
// 剥不干净（UNC、网络共享、其他协议、越界绝对路径）时返回 null，由渲染层回落原文。
export interface SessionFileLinks {
  projectId: number;
  sessionId: number;
  /** 本 session 的工作区根绝对路径；缺失（非 worktree 等）时无法相对化绝对路径。 */
  workspacePath: string | null;
  /** 用户 Home 绝对路径，用于展开 `~/`；解析失败时为 null。 */
  homePath: string | null;
  /** 打开工作区相对路径对应的文件（侧栏 `SessionFileViewer`）。 */
  openFilePath(filePath: string): void;
}

/** 链接目标的三态：外部链接 / 本地文件（带行号信息）/ 无法解析。 */
export type FileReference =
  | { kind: "external"; href: string }
  | {
      kind: "local";
      href: string;
      path: string;
      line: number | null;
      column: number | null;
    }
  | { kind: "unresolved"; href: string };

/** 带行号后缀的路径（`resource` + 位置），行号只解析不跳转。 */
interface ResourceLocation {
  resource: string;
  line: number | null;
  column: number | null;
}

/** Windows 盘符绝对路径（`C:\...` / `C:/...`），不能当协议前缀处理。 */
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
/** 形如 `mailto:` / `vscode://` 的协议前缀。 */
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** 锚点 / 查询串开头，不是文件路径。 */
const FRAGMENT_OR_QUERY_PATTERN = /^[#?]/;

function isNetworkSharePath(path: string): boolean {
  return path.startsWith("//") || path.startsWith("\\\\");
}

/**
 * 剥掉行号后缀：`:line[:col]` 与 `#L12` / `#L12C3`。
 *
 * 只解析不跳转（本任务不提供滚动到行能力），行号信息随三态对象返回给调用方。
 */
function splitResourceLocation(rawPath: string): ResourceLocation {
  const hashMatch = /^(.*)#L(\d+)(?:C(\d+))?$/.exec(rawPath);
  if (hashMatch) {
    return {
      resource: hashMatch[1],
      line: Number(hashMatch[2]),
      column: hashMatch[3] === undefined ? null : Number(hashMatch[3]),
    };
  }

  // `:line:col` 必须先于 `:line` 匹配，否则贪婪的 `:line` 会把列号当成行号。
  const lineAndColumnMatch = /^(.*):(\d+):(\d+)$/.exec(rawPath);
  if (lineAndColumnMatch) {
    return {
      resource: lineAndColumnMatch[1],
      line: Number(lineAndColumnMatch[2]),
      column: Number(lineAndColumnMatch[3]),
    };
  }

  const lineMatch = /^(.*):(\d+)$/.exec(rawPath);
  if (lineMatch) {
    return {
      resource: lineMatch[1],
      line: Number(lineMatch[2]),
      column: null,
    };
  }

  return { resource: rawPath, line: null, column: null };
}

function decodePath(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * 判断链接目标是不是「可能是本地文件」的语法形状。
 *
 * 与 OpenCode `inlineCodeKind` 同思路：只是廉价语法检查，真正的可点性还要
 * `resolveWorkspaceRelativePath` 确认落在工作区内。UNC / 网络共享直接排除，
 * 避免为了打开文件去探测网络共享。
 */
function looksLikeLocalFilePath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (FRAGMENT_OR_QUERY_PATTERN.test(path)) {
    return false;
  }
  if (isNetworkSharePath(path)) {
    return false;
  }
  if (/^file:\/\//i.test(path)) {
    return true;
  }
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)) {
    return true;
  }
  if (URI_SCHEME_PATTERN.test(path)) {
    return false;
  }
  // 相对路径里的空白是散文而非路径（例如行内代码里的整句英文），保持不可点。
  // 绝对路径与 `~/` 允许含空白：用户目录 / 工作区目录本身可能有空格。
  if (!path.startsWith("/") && !path.startsWith("~") && /\s/.test(path)) {
    return false;
  }
  return true;
}

/**
 * 把链接目标分成三态。
 *
 * - `http(s)` → 外部链接，由渲染层维持新标签页行为；
 * - 本地文件候选（`file:`、工作区绝对路径、`~/`、相对路径）→ `local`，
 *   是否真的能打开由 `resolveWorkspaceRelativePath` 判定；
 * - UNC / 网络共享 / 其他协议 / 锚点 / 含空白的相对路径 → 不可点。
 */
export function parseFileReference(rawHref: string): FileReference {
  if (rawHref.length === 0) {
    return { kind: "unresolved", href: rawHref };
  }
  if (/^https?:\/\//i.test(rawHref)) {
    return { kind: "external", href: rawHref };
  }

  const location = splitResourceLocation(rawHref);
  if (!looksLikeLocalFilePath(location.resource)) {
    return { kind: "unresolved", href: rawHref };
  }

  return {
    kind: "local",
    href: rawHref,
    path: location.resource,
    line: location.line,
    column: location.column,
  };
}

/** 把工作区内绝对路径收成相对路径；不在工作区内（含 workspacePath 缺失）返回 null。 */
function relativizeToWorkspace(
  absolutePath: string,
  workspacePath: string | null,
): string | null {
  if (workspacePath === null || workspacePath.length === 0) {
    return null;
  }

  const workspaceRoot = workspacePath.replace(/\/+$/, "");
  if (
    workspaceRoot.length === 0 ||
    !absolutePath.startsWith(`${workspaceRoot}/`)
  ) {
    return null;
  }

  const relativePath = absolutePath.slice(workspaceRoot.length + 1);
  // 工作区根目录本身不是文件。
  return relativePath.length === 0 ? null : relativePath;
}

/** 展开 `~` / `~/` 前缀；无法展开返回 null。 */
function expandHomePath(path: string, homePath: string | null): string | null {
  if (path !== "~" && !path.startsWith("~/")) {
    return null;
  }
  if (homePath === null || homePath.length === 0) {
    return null;
  }

  const homeRoot = homePath.replace(/\/+$/, "");
  if (path === "~") {
    return homeRoot;
  }
  return `${homeRoot}/${path.slice(2)}`;
}

/**
 * 把候选路径收成工作区相对路径；无法确定时返回 null（渲染层回落原文）。
 *
 * 处理顺序：剥 `file://` → 剥行号后缀 → 展开 `~/` → 工作区内绝对路径收成相对路径 →
 * 相对路径去掉 `./` 前缀。不解析符号链接、不折叠 `.` / `..`，越界即 null。
 */
export function resolveWorkspaceRelativePath(
  rawPath: string,
  workspacePath: string | null,
  homePath: string | null,
): string | null {
  let candidate = rawPath;
  if (/^file:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^file:\/\//i, "");
  }
  candidate = splitResourceLocation(candidate).resource;

  if (
    isNetworkSharePath(candidate) ||
    FRAGMENT_OR_QUERY_PATTERN.test(candidate)
  ) {
    return null;
  }

  const decodedPath = decodePath(candidate);
  if (decodedPath === null) {
    return null;
  }

  const expandedHomePath = expandHomePath(decodedPath, homePath);
  if (expandedHomePath !== null) {
    return relativizeToWorkspace(expandedHomePath, workspacePath);
  }
  if (decodedPath.startsWith("~")) {
    // `~user/...` 这类无法用 homeDir() 展开的写法保持不可点。
    return null;
  }
  if (
    !WINDOWS_ABSOLUTE_PATH_PATTERN.test(decodedPath) &&
    URI_SCHEME_PATTERN.test(decodedPath)
  ) {
    // `https://` / `mailto:` 等协议目标不是本地文件。
    return null;
  }
  if (
    decodedPath.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(decodedPath)
  ) {
    return relativizeToWorkspace(decodedPath, workspacePath);
  }

  const relativePath = decodedPath.replace(/^\.\//, "");
  if (relativePath.length === 0 || relativePath === ".") {
    return null;
  }
  // `..` 会离开工作区：后端拒绝越界路径，前端也直接判定不可点。
  if (relativePath === ".." || relativePath.startsWith("../")) {
    return null;
  }
  return relativePath;
}
