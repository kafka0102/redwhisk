// 助手消息里的围栏代码块：语法高亮 + 复制按钮。
//
// 只引 `highlight.js/lib/core` 并显式注册常用语言，语言由围栏 info string 映射；
// 没有 info string 或语言未注册时不猜，直接按纯文本渲染。高亮抛错同样回落纯文本，
// 保证消息流不会因为一段代码崩掉。
// 文本提取与语言映射都在本 feature 内实现，不跨 feature 引 `features/code` 的 helper。

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Copy } from "lucide-react";
import { useCallback, useMemo } from "react";

import { copyTextToClipboard } from "../../../shared/commands/copy-text-to-clipboard";
import { useI18n } from "../../../shared/i18n/i18n";
import { toast } from "../../../shared/toast";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/** 围栏 info string → 已注册的 highlight.js 语言 id；未列出的一律按纯文本处理。 */
const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string | undefined> = {
  bash: "bash",
  cjs: "javascript",
  console: "bash",
  css: "css",
  diff: "diff",
  go: "go",
  htm: "xml",
  html: "xml",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  less: "css",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  patch: "diff",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sass: "css",
  scss: "css",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  svg: "xml",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/**
 * react-markdown 把围栏 info string 放在 `language-*` class 上。
 * 返回小写 info string；没有围栏语言时返回 `null`。
 */
function codeBlockInfoString(className: string | undefined): string | null {
  if (typeof className !== "string") {
    return null;
  }
  const match = /language-(\S+)/i.exec(className);
  return match === null ? null : match[1].toLowerCase();
}

/** 高亮后的 HTML；语言未注册或高亮抛错时返回 `null`，由调用方回落纯文本。 */
function highlightCode(code: string, info: string | null): string | null {
  const language = info === null ? undefined : HIGHLIGHT_LANGUAGE_ALIASES[info];
  if (language === undefined) {
    return null;
  }
  try {
    // `ignoreIllegals`：流式输出时中间态代码常常还不完整，不让它升级成异常。
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}

interface MessageCodeBlockProps {
  /** react-markdown 传下来的 `language-*` class，没有围栏语言时为 `undefined`。 */
  className: string | undefined;
  /** 围栏内的原文。 */
  code: string;
}

/** 围栏代码块：语言标签 + icon-only 复制按钮 + `<pre><code>`。 */
export function MessageCodeBlock({ className, code }: MessageCodeBlockProps) {
  const { messages, t } = useI18n();
  const info = codeBlockInfoString(className);
  const highlighted = useMemo(() => highlightCode(code, info), [code, info]);

  const handleCopy = useCallback(async () => {
    if (await copyTextToClipboard(code)) {
      toast.success(messages.agentsFeature.copiedToClipboard);
      return;
    }
    // 新增文案只走 `t("agentsFeature.x")`，不扩 `I18nMessages` 接口。
    toast.error(t("agentsFeature.copyFailed"));
  }, [code, messages.agentsFeature.copiedToClipboard, t]);

  return (
    <div className="agents-message__code-block-shell">
      <div className="agents-message__code-block-header">
        {info === null ? null : (
          <span className="agents-message__code-block-language">{info}</span>
        )}
        <button
          type="button"
          className="agents-message__code-block-copy"
          aria-label={t("agentsFeature.copyCode")}
          onClick={() => void handleCopy()}
        >
          <Copy aria-hidden="true" size={12} strokeWidth={1.8} />
        </button>
      </div>
      <pre className="agents-message__code-block">
        {highlighted === null ? (
          // 回落分支渲染原始文本：语言未注册或高亮抛错时逐字保留原文。
          <code className={className}>{code}</code>
        ) : (
          // highlight.js 的 value 是它自己对原文做 HTML 转义后拼出的标记，
          // 只产出 `<span class="hljs-*">` 包裹的转义文本，不会带出代码里的原始标签。
          <code
            className={className}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </pre>
    </div>
  );
}
