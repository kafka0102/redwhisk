import * as monaco from "monaco-editor";

import type { CodeLanguageDiagnostic } from "./code-language-commands";
import { toCodeLanguageFileUri } from "./code-language-uri";

export const CODE_LANGUAGE_MARKER_OWNER = "redwhisk-code-language";

const lastDiagnostics = new Map<string, CodeLanguageDiagnostic[]>();

export function applyCodeLanguageMarkers(
  uri: string,
  diagnostics: CodeLanguageDiagnostic[],
): void {
  lastDiagnostics.set(uri, diagnostics);
  syncCodeLanguageMarkersToModel(uri);
}

export function clearCodeLanguageMarkersForUri(uri: string): void {
  lastDiagnostics.set(uri, []);
  syncCodeLanguageMarkersToModel(uri);
  lastDiagnostics.delete(uri);
}

export function clearCodeLanguageMarkersForRoot(workspacePath: string): void {
  const rootUri = toCodeLanguageFileUri(workspacePath, "");
  const prefix = rootUri.endsWith("/") ? rootUri.slice(0, -1) : rootUri;
  for (const uri of [...lastDiagnostics.keys()]) {
    if (uri === prefix || uri.startsWith(`${prefix}/`)) {
      clearCodeLanguageMarkersForUri(uri);
    }
  }
}

export function syncCodeLanguageMarkersToModel(uri: string): void {
  const diagnostics = lastDiagnostics.get(uri);
  if (!diagnostics) {
    return;
  }
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!model) {
    return;
  }
  monaco.editor.setModelMarkers(
    model,
    CODE_LANGUAGE_MARKER_OWNER,
    diagnostics.map(toMonacoMarker),
  );
}

export function getAppliedCodeLanguageMarkers(
  uri: string,
): readonly CodeLanguageDiagnostic[] {
  return lastDiagnostics.get(uri) ?? [];
}

export function resetCodeLanguageMarkersForTests(): void {
  lastDiagnostics.clear();
}

function toMonacoMarker(
  diagnostic: CodeLanguageDiagnostic,
): monaco.editor.IMarkerData {
  return {
    message: diagnostic.message,
    severity: toMarkerSeverity(diagnostic.severity),
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    source: diagnostic.source,
    code: diagnostic.code,
  };
}

function toMarkerSeverity(severity: number | undefined): monaco.MarkerSeverity {
  switch (severity) {
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}
