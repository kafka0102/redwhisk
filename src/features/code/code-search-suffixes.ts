import type { WorkspaceFileTreeNode } from "../../shared/workspace/workspace-commands";

/** 代码类后缀优先于文档/配置类（用于 top-N 排序）。 */
const CODE_LIKE_SUFFIXES = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "rs",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "cs",
  "swift",
  "rb",
  "php",
  "scala",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "vue",
  "svelte",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "lua",
  "r",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "ml",
  "zig",
  "nim",
  "clj",
  "cljs",
  "groovy",
  "pl",
  "pm",
]);

const DEFAULT_TOP_SUFFIX_LIMIT = 8;

/**
 * 从文件树 nodes 聚合后缀，返回当前代码根最常见的前 N 个（默认 8）。
 * 排序：代码类优先 → 出现次数降序 → 后缀名升序。
 * 由文件树 nodes 变化触发重算（nodes 随 signature 更新），无需独立 watcher。
 */
export function collectTopFileSuffixes(
  nodes: readonly WorkspaceFileTreeNode[],
  limit: number = DEFAULT_TOP_SUFFIX_LIMIT,
): string[] {
  if (limit <= 0 || nodes.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  walkFileTree(nodes, counts);

  return [...counts.entries()]
    .sort((left, right) => {
      const leftCode = CODE_LIKE_SUFFIXES.has(left[0]) ? 0 : 1;
      const rightCode = CODE_LIKE_SUFFIXES.has(right[0]) ? 0 : 1;
      if (leftCode !== rightCode) {
        return leftCode - rightCode;
      }
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([suffix]) => suffix);
}

/** 点选 `.ts` 时写入 include/exclude 的 glob。 */
export function suffixToIncludeGlob(suffix: string): string {
  const normalized = suffix.trim().replace(/^\./, "").toLowerCase();
  return `**/*.${normalized}`;
}

/** 将输入文本拆成多个 filter tag（逗号/中文逗号/换行分隔）。 */
export function parseFilterTagInput(text: string): string[] {
  return text
    .split(/[,，\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 追加 tag，已存在则保持原序不变。 */
export function appendFilterTags(
  current: readonly string[],
  nextTags: readonly string[],
): string[] {
  if (nextTags.length === 0) {
    return [...current];
  }
  const result = [...current];
  const seen = new Set(current);
  for (const tag of nextTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

function walkFileTree(
  nodes: readonly WorkspaceFileTreeNode[],
  counts: Map<string, number>,
): void {
  for (const node of nodes) {
    if (node.kind === "file") {
      const suffix = extractFileSuffix(node.name);
      if (suffix) {
        counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
      }
      continue;
    }
    if (node.children && node.children.length > 0) {
      walkFileTree(node.children, counts);
    }
  }
}

function extractFileSuffix(fileName: string): string | null {
  const base = fileName.includes("/")
    ? (fileName.split("/").pop() ?? fileName)
    : fileName;
  // lastDot <= 0：无扩展名，或 `.gitignore` 这类仅前导点文件。
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) {
    return null;
  }
  return base.slice(lastDot + 1).toLowerCase();
}
