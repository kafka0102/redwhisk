/**
 * Shell 类项目终端判定（与后端 shell_kind 对齐的前端近似）：
 * - trim 后为空 → Shell 类
 * - 命令 basename 为常见交互 shell（zsh/bash/sh/fish）→ Shell 类
 * 后端以 `$SHELL` 精确等价为准；前端用于决定是否 ensure，略宽不窄。
 */
export function isShellLikeLaunchCommand(launchCommand: string): boolean {
  const trimmed = launchCommand.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const segments = trimmed.split(/[/\\]/);
  const basename = segments[segments.length - 1] ?? trimmed;
  const normalized = basename.toLowerCase();
  return (
    normalized === "zsh" ||
    normalized === "bash" ||
    normalized === "sh" ||
    normalized === "fish" ||
    normalized.startsWith("zsh-") ||
    normalized.startsWith("bash-")
  );
}

export function hasInactiveShellLikeTerminal(
  terminals: ReadonlyArray<{ sessionId: number; launchCommand: string }>,
): boolean {
  return terminals.some(
    (terminal) =>
      terminal.sessionId === 0 &&
      isShellLikeLaunchCommand(terminal.launchCommand),
  );
}
