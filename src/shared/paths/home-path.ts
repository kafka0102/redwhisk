export function formatHomePathForDisplay(path: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return "";
  }

  const unixHomePath = /^\/(?:users|home)\/[^/]+(?:\/|$)/i;
  if (unixHomePath.test(trimmedPath)) {
    return trimmedPath.replace(/^\/(?:users|home)\/[^/]+/i, "~");
  }

  const windowsHomePath = /^[A-Za-z]:\\Users\\[^\\]+(?:\\|$)/;
  if (windowsHomePath.test(trimmedPath)) {
    return trimmedPath.replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
  }

  return trimmedPath;
}
