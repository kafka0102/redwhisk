import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

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
  hasConfiguredMonacoEditor = true;
}
