/**
 * 把拖入终端的文件路径格式化为可写入 PTY stdin 的字符串。
 *
 * 设计：POSIX 单引号包裹每个路径，内部单引号按 `'\''` 转义，多路径以单个空格连接。
 * 这样无论路径是否含空格 / 特殊字符，bash/zsh/fish 都能还原字面值，对齐 iTerm2 /
 * Warp 拖入文件「插入转义路径」的行为。
 */
export function formatDroppedPaths(paths: readonly string[]): string {
  return paths.map((path) => `'${path.replace(/'/g, `'\\''`)}'`).join(" ");
}

/** 物理像素点是否落在 CSS 像素 rect 内（半开区间 [left,right) × [top,bottom)）。 */
export function isPositionInRect(
  physicalX: number,
  physicalY: number,
  rect: { left: number; top: number; right: number; bottom: number },
  devicePixelRatio: number,
): boolean {
  if (!(devicePixelRatio > 0)) {
    return false;
  }
  const cssX = physicalX / devicePixelRatio;
  const cssY = physicalY / devicePixelRatio;
  return (
    cssX >= rect.left &&
    cssX < rect.right &&
    cssY >= rect.top &&
    cssY < rect.bottom
  );
}
