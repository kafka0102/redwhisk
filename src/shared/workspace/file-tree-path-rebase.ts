/** 把等于 `from` 或以 `from/` 开头的相对路径改挂到 `to`。其余路径原样返回。 */
export function rebaseRelativePath(
  path: string,
  from: string,
  to: string,
): string {
  if (from.length === 0) {
    return path;
  }
  if (path === from) {
    return to;
  }
  const prefix = `${from}/`;
  if (path.startsWith(prefix)) {
    return `${to}${path.slice(from.length)}`;
  }
  return path;
}
