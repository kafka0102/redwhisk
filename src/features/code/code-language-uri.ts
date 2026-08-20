export function toCodeLanguageFileUri(
  workspacePath: string,
  filePath: string,
): string {
  const root = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = relative.length > 0 ? `${root}/${relative}` : root;
  if (absolute.startsWith("/")) {
    return `file://${absolute}`;
  }
  return `file:///${absolute}`;
}
