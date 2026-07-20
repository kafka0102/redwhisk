import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

import { registerPrismaLanguage } from "./monaco-prisma-language";

interface MonacoEnvironmentConfig {
  getWorker: (_workerId: string, label: string) => Worker;
}

type MonacoGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoEnvironmentConfig;
};

let hasConfiguredMonacoEditor = false;

export function configureMonacoEditor() {
  if (hasConfiguredMonacoEditor) {
    return;
  }

  const monacoGlobal = globalThis as MonacoGlobal;
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      if (label === "json") {
        return new jsonWorker();
      }

      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }

      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }

      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }

      return new editorWorker();
    },
  };

  loader.config({ monaco });
  registerPrismaLanguage(monaco);

  // 项目内 Monaco 仅作只读代码查看（code-workspace / session-file-viewer / diff），
  // 关闭 TS/JS 语义诊断：默认 compilerOptions 未设 jsx，会把 tsx 里 JSX 对组件的引用
  // 判为 unused 而标灰（"All imports in import declaration are unused."）。语法高亮不受影响。
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
  });
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
  });

  hasConfiguredMonacoEditor = true;
}
