// 行内代码（单反引号 span）里「看起来像工作区内文件路径」的廉价语法判定。
//
// 与 OpenCode `inlineCodeKind` 同思路：这里只做便宜的字符检查，不碰文件系统；
// 行内代码真正变成可点元素还要工作区相对化成功 + 后端确认文件存在
// （见 `use-workspace-file-existence.ts`）。

import { resolveWorkspaceRelativePath } from "./session-file-links";

/** 行内代码的语法形状；`path` 只表示「像文件路径」，不代表文件存在。 */
export type InlineCodeKind = "path" | "other";

/** 空白与代码符号：出现即说明这是散文或表达式，不是路径。 */
const CODE_SYMBOL_PATTERN = /[\s(){}[\]"'=,*?!<>|;`]/;
/** `http://` / `mailto:` 等协议前缀。 */
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
/** 反斜杠开头的 UNC / 网络共享。 */
const WINDOWS_NETWORK_SHARE_PATTERN = /^\\\\/;
/** 最后一段带扩展名（`a.ts`、`src/app/a.tsx`）。 */
const EXTENSION_PATTERN = /\/?[^/]+\.[A-Za-z0-9]+$/;
/** 无扩展名的常见文件名白名单。 */
const EXTENSIONLESS_FILE_NAMES = new Set(["Dockerfile", "Makefile", "LICENSE"]);

/**
 * 判定行内代码是不是「看起来像工作区内文件路径」。
 *
 * 排除：含空白或代码符号、`xxx://` 协议、`\\` / `//` 开头的网络共享（避免为了
 * 探测存在性去连网）、`-flag`、以 `/` 或 `~` 开头的绝对路径（交给链接分类）、
 * 目录形状（以 `/` 结尾）。剩余只接受「含 `/`」「带扩展名」或白名单无扩展名文件名。
 */
export function inlineCodeKind(text: string): InlineCodeKind {
  if (text.length === 0) {
    return "other";
  }
  if (CODE_SYMBOL_PATTERN.test(text)) {
    return "other";
  }
  if (text.startsWith("//") || WINDOWS_NETWORK_SHARE_PATTERN.test(text)) {
    return "other";
  }
  if (URL_SCHEME_PATTERN.test(text)) {
    return "other";
  }
  if (text.startsWith("/") || text.startsWith("~") || text.startsWith("-")) {
    return "other";
  }
  if (text.endsWith("/")) {
    return "other";
  }
  if (text.includes("/")) {
    return "path";
  }
  if (EXTENSION_PATTERN.test(text)) {
    return "path";
  }
  return EXTENSIONLESS_FILE_NAMES.has(text) ? "path" : "other";
}

/**
 * 把行内代码收成工作区相对路径；不像路径或无法相对化时返回 `null`。
 *
 * 行内代码不接管 `/` 开头的绝对路径（那是 Markdown 链接的分类职责），
 * 只处理工作区相对写法。
 */
export function resolveInlineCodeFilePath(
  text: string,
  workspacePath: string | null,
  homePath: string | null,
): string | null {
  if (inlineCodeKind(text) !== "path") {
    return null;
  }
  return resolveWorkspaceRelativePath(text, workspacePath, homePath);
}

/** 围栏代码块的起始 / 结束行（``` 或 ~~~，≥3 个字符，可带语言标注）。 */
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

/**
 * 扫出消息文本里单反引号 span 的内容。
 *
 * 围栏代码块内的内容不是行内代码，先按行剔除围栏块再匹配，避免把代码块里的路径
 * 当候选去探测存在性。
 */
export function extractInlineCodeTexts(markdown: string): string[] {
  const keptLines: string[] = [];
  let isInFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE_PATTERN.test(line)) {
      isInFence = !isInFence;
      continue;
    }
    if (!isInFence) {
      keptLines.push(line);
    }
  }

  const texts: string[] = [];
  for (const match of keptLines.join("\n").matchAll(/`([^`\n]+)`/g)) {
    texts.push(match[1]);
  }
  return texts;
}
