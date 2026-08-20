import { toCodeLanguageFileUri } from "./code-language-uri";
import type { CodeLanguageLocation } from "./code-language-commands";

export interface CodeLanguageOpenMatch {
  fileName: string;
  filePath: string;
  lineNumber: number;
}

export function toWorkspaceRelativeFilePath(
  workspacePath: string,
  filePathOrUri: string,
): string | null {
  const workspaceUri = toCodeLanguageFileUri(workspacePath, "").replace(
    /\/+$/,
    "",
  );
  const normalizedWorkspace = workspacePath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const candidate = filePathOrUri.trim();
  if (candidate.startsWith("file:")) {
    const normalizedUri = candidate.replace(/\/+$/, "");
    if (normalizedUri === workspaceUri) {
      return "";
    }
    const prefix = `${workspaceUri}/`;
    if (!normalizedUri.startsWith(prefix)) {
      return null;
    }
    return decodeURIComponent(normalizedUri.slice(prefix.length));
  }

  const normalizedPath = candidate.replace(/\\/g, "/");
  if (normalizedPath === normalizedWorkspace) {
    return "";
  }
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  if (
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    return null;
  }
  return normalizedPath;
}

export function selectWorkspaceDefinitionLocations(
  workspacePath: string,
  locations: CodeLanguageLocation[],
): CodeLanguageLocation[] {
  const selected: CodeLanguageLocation[] = [];
  for (const location of locations) {
    const filePath = toWorkspaceRelativeFilePath(
      workspacePath,
      location.filePath,
    );
    if (filePath == null || filePath.length === 0) {
      continue;
    }
    selected.push({ ...location, filePath });
  }
  return selected;
}

export function toRevealLineNumber(
  selectionOrPosition?: {
    startLineNumber?: number;
    lineNumber?: number;
  } | null,
): number {
  const line =
    selectionOrPosition?.startLineNumber ??
    selectionOrPosition?.lineNumber ??
    1;
  return line >= 1 ? line : 1;
}

export function openCodeLanguageDefinitionMatch(options: {
  workspacePath: string;
  uri: string;
  lineNumber: number;
  openMatch: (match: CodeLanguageOpenMatch) => void;
}): boolean {
  const filePath = toWorkspaceRelativeFilePath(
    options.workspacePath,
    options.uri,
  );
  if (filePath == null || filePath.length === 0) {
    return false;
  }
  const segments = filePath.split("/");
  const fileName = segments[segments.length - 1] ?? filePath;
  options.openMatch({
    fileName,
    filePath,
    lineNumber: options.lineNumber >= 1 ? options.lineNumber : 1,
  });
  return true;
}
