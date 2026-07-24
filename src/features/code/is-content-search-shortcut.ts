/**
 * 内容搜索快捷键：macOS 为 Cmd+Shift+F，Win/Linux 为 Ctrl+Shift+F。
 * 仅识别修饰键组合本身，不负责挂载范围（由 Code Activity 生命周期约束）。
 */
export function isContentSearchShortcut(event: KeyboardEvent): boolean {
  if (event.type !== "keydown") {
    return false;
  }

  if (event.key.toLowerCase() !== "f" || !event.shiftKey) {
    return false;
  }

  if (event.altKey) {
    return false;
  }

  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}
