import { memo } from "react";

type SyntaxLanguage =
  | "css"
  | "generic"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "python"
  | "rust"
  | "shell"
  | "tsx"
  | "typescript";

type DiffLineKind = "add" | "delete" | "context" | "hunk" | "meta";

interface SyntaxToken {
  text: string;
  kind?: string;
}

interface HighlightPattern {
  kind: string;
  regex: RegExp;
}

interface ParsedDiffLine {
  kind: DiffLineKind;
  prefix: string;
  content: string;
}

interface HighlightedDiffBlockProps {
  diff: string;
  path: string;
}

const EXTENSION_LANGUAGE: Record<string, SyntaxLanguage> = {
  bash: "shell",
  cjs: "javascript",
  css: "css",
  htm: "html",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  less: "css",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sass: "css",
  scss: "css",
  sh: "shell",
  svg: "html",
  ts: "typescript",
  tsx: "tsx",
  xml: "html",
  zsh: "shell",
};

const JAVASCRIPT_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "return",
  "satisfies",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "while",
  "yield",
]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

export const HighlightedDiffBlock = memo(function HighlightedDiffBlock({
  diff,
  path,
}: HighlightedDiffBlockProps) {
  const language = detectLanguage(path);
  const lines = splitDiffLines(diff);
  return (
    <pre className="agents-message__output agents-message__output--diff">
      <code className="agents-message__diff-code" data-language={language}>
        {lines.map((line, index) => {
          const parsedLine = parseDiffLine(line);
          const tokens =
            parsedLine.kind === "hunk" || parsedLine.kind === "meta"
              ? [{ text: parsedLine.content, kind: parsedLine.kind }]
              : highlightSyntaxLine(parsedLine.content, language);
          return (
            <span
              className={`agents-message__diff-line agents-message__diff-line--${parsedLine.kind}`}
              data-line-kind={parsedLine.kind}
              key={`${index}-${line}`}
            >
              <span className="agents-message__diff-prefix" aria-hidden="true">
                {parsedLine.prefix}
              </span>
              <span className="agents-message__diff-content">
                {tokens.map((token, tokenIndex) => (
                  <span
                    className={
                      token.kind
                        ? `agents-message__syntax agents-message__syntax--${token.kind}`
                        : undefined
                    }
                    key={`${tokenIndex}-${token.text}`}
                  >
                    {token.text}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
});

function splitDiffLines(diff: string): string[] {
  const normalizedDiff = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalizedDiff) {
    return [];
  }
  return normalizedDiff.endsWith("\n")
    ? normalizedDiff.slice(0, -1).split("\n")
    : normalizedDiff.split("\n");
}

function parseDiffLine(line: string): ParsedDiffLine {
  if (line.startsWith("@@")) {
    return { kind: "hunk", prefix: "", content: line };
  }
  if (line.startsWith("\\ No newline")) {
    return { kind: "meta", prefix: "", content: line };
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { kind: "add", prefix: "+", content: line.slice(1) };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return { kind: "delete", prefix: "-", content: line.slice(1) };
  }
  if (line.startsWith(" ")) {
    return { kind: "context", prefix: " ", content: line.slice(1) };
  }
  return { kind: "meta", prefix: "", content: line };
}

function detectLanguage(path: string): SyntaxLanguage {
  const normalizedPath = path.toLowerCase().split(/[?#]/)[0] ?? "";
  const pathSegments = normalizedPath.split(/[\\/]/);
  const fileName = pathSegments[pathSegments.length - 1] ?? "";
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "shell";
  }
  if (fileName === "makefile") {
    return "shell";
  }
  if (fileName.endsWith(".d.ts")) {
    return "typescript";
  }
  const fileNameSegments = fileName.split(".");
  const extension = fileName.includes(".")
    ? fileNameSegments[fileNameSegments.length - 1]
    : "";
  return extension ? (EXTENSION_LANGUAGE[extension] ?? "generic") : "generic";
}

function highlightSyntaxLine(
  line: string,
  language: SyntaxLanguage,
): SyntaxToken[] {
  switch (language) {
    case "json":
      return tokenize(line, jsonPatterns);
    case "css":
      return tokenize(line, cssPatterns);
    case "html":
      return tokenize(line, htmlPatterns);
    case "markdown":
      return tokenize(line, markdownPatterns);
    case "python":
      return tokenize(line, createKeywordPatterns(PYTHON_KEYWORDS, "python"));
    case "rust":
      return tokenize(line, createKeywordPatterns(RUST_KEYWORDS, "rust"));
    case "shell":
      return tokenize(line, shellPatterns);
    case "javascript":
    case "tsx":
    case "typescript":
      return tokenize(
        line,
        createKeywordPatterns(JAVASCRIPT_KEYWORDS, "javascript"),
      );
    case "generic":
    default:
      return tokenize(line, genericPatterns);
  }
}

function tokenize(line: string, patterns: HighlightPattern[]): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const input = line.slice(index);
    const match = patterns
      .map((pattern) => ({ pattern, match: input.match(pattern.regex) }))
      .find(({ match }) => match?.index === 0 && match[0].length > 0);
    if (match?.match) {
      tokens.push({ text: match.match[0], kind: match.pattern.kind });
      index += match.match[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? "" });
    index += 1;
  }
  return tokens;
}

function createKeywordPatterns(
  keywords: Set<string>,
  language: "javascript" | "python" | "rust",
): HighlightPattern[] {
  const lineComment =
    language === "python"
      ? /^#.*/
      : language === "rust"
        ? /^\/\/\/.*|^\/\/.*/
        : /^\/\/.*/;
  return [
    { kind: "comment", regex: lineComment },
    { kind: "comment", regex: /^\/\*.*?\*\// },
    { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
    { kind: "string", regex: /^'(?:\\.|[^'\\])*'/ },
    { kind: "string", regex: /^`(?:\\.|[^`\\])*`/ },
    { kind: "decorator", regex: /^@[A-Za-z_$][\w$]*/ },
    { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
    { kind: "literal", regex: /^\b(?:false|null|None|true|undefined)\b/ },
    {
      kind: "function",
      regex: /^[A-Za-z_$][\w$]*(?=\s*\()/,
    },
    { kind: "type", regex: /^[A-Z][A-Za-z0-9_$]*/ },
    {
      kind: "keyword",
      regex: new RegExp(`^\\b(?:${Array.from(keywords).join("|")})\\b`),
    },
    { kind: "operator", regex: /^[{}()[\].,:;<>+\-*/%=&|!?~^]+/ },
  ];
}

const jsonPatterns: HighlightPattern[] = [
  { kind: "property", regex: /^"(?:\\.|[^"\\])*"(?=\s*:)/ },
  { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
  { kind: "number", regex: /^-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i },
  { kind: "literal", regex: /^\b(?:false|null|true)\b/ },
  { kind: "operator", regex: /^[{}[\],:]/ },
];

const cssPatterns: HighlightPattern[] = [
  { kind: "comment", regex: /^\/\*.*?\*\// },
  { kind: "property", regex: /^--[\w-]+(?=\s*:)/ },
  { kind: "property", regex: /^[a-z-]+(?=\s*:)/i },
  { kind: "keyword", regex: /^@[\w-]+/ },
  { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
  { kind: "string", regex: /^'(?:\\.|[^'\\])*'/ },
  { kind: "literal", regex: /^#[0-9a-f]{3,8}\b/i },
  { kind: "number", regex: /^-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b/ },
  { kind: "function", regex: /^[a-z-]+(?=\()/i },
  { kind: "operator", regex: /^[{}()[\].,:;<>+\-*/%=&|!?~^]+/ },
];

const htmlPatterns: HighlightPattern[] = [
  { kind: "comment", regex: /^<!--.*?-->/ },
  { kind: "keyword", regex: /^<\/?[A-Za-z][\w:-]*/ },
  { kind: "property", regex: /^[A-Za-z_:][\w:.-]*(?==)/ },
  { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
  { kind: "string", regex: /^'(?:\\.|[^'\\])*'/ },
  { kind: "operator", regex: /^[<>/=]+/ },
];

const markdownPatterns: HighlightPattern[] = [
  { kind: "keyword", regex: /^#{1,6}(?=\s)/ },
  { kind: "keyword", regex: /^```.*$/ },
  { kind: "comment", regex: /^>\s.*$/ },
  { kind: "operator", regex: /^[*_`~[\]()#-]+/ },
];

const shellPatterns: HighlightPattern[] = [
  { kind: "comment", regex: /^#.*/ },
  { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
  { kind: "string", regex: /^'(?:\\.|[^'\\])*'/ },
  { kind: "variable", regex: /^\$\{[^}]+\}|^\$[A-Za-z_]\w*/ },
  {
    kind: "keyword",
    regex:
      /^\b(?:case|do|done|elif|else|esac|export|fi|for|function|if|in|local|return|then|while)\b/,
  },
  { kind: "property", regex: /^--?[A-Za-z0-9][\w-]*/ },
  { kind: "operator", regex: /^[{}()[\].,:;<>+\-*/%=&|!?~^]+/ },
];

const genericPatterns: HighlightPattern[] = [
  { kind: "string", regex: /^"(?:\\.|[^"\\])*"/ },
  { kind: "string", regex: /^'(?:\\.|[^'\\])*'/ },
  { kind: "number", regex: /^\b\d+(?:\.\d+)?\b/ },
  { kind: "operator", regex: /^[{}()[\].,:;<>+\-*/%=&|!?~^]+/ },
];
