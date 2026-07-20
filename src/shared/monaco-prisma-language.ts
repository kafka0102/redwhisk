import type * as Monaco from "monaco-editor";

const PRISMA_LANGUAGE_ID = "prisma";

let hasRegisteredPrismaLanguage = false;

/**
 * Monaco 内置语言不含 Prisma；只读查看器需要显式注册 Monarch 语法。
 * 幂等：重复调用不会二次 register。
 */
export function registerPrismaLanguage(monacoApi: typeof Monaco): void {
  if (hasRegisteredPrismaLanguage) {
    return;
  }

  const alreadyRegistered = monacoApi.languages
    .getLanguages()
    .some((language) => language.id === PRISMA_LANGUAGE_ID);
  if (alreadyRegistered) {
    hasRegisteredPrismaLanguage = true;
    return;
  }

  monacoApi.languages.register({
    id: PRISMA_LANGUAGE_ID,
    extensions: [".prisma"],
    aliases: ["Prisma", "prisma"],
  });

  monacoApi.languages.setMonarchTokensProvider(PRISMA_LANGUAGE_ID, {
    defaultToken: "",
    tokenPostfix: ".prisma",
    tokenizer: {
      root: [
        [/\/\/\/.*$/, "comment.doc"],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],
        [/@{1,2}[A-Za-z_]\w*/, "annotation"],
        [
          /\b(?:model|enum|datasource|generator|type|view|true|false|null)\b/,
          "keyword",
        ],
        [
          /\b(?:String|Boolean|Int|BigInt|Float|Decimal|DateTime|Json|Bytes|Unsupported)\b/,
          "type",
        ],
        [/[A-Za-z_]\w*/, "identifier"],
        [/[{}()[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
        [/[<>]=?|[=!?]/, "operator"],
        [/\d+(?:\.\d+)?/, "number"],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
    },
  });

  hasRegisteredPrismaLanguage = true;
}
