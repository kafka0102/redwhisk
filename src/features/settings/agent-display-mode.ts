import type { AgentDisplayMode } from "./settings-commands";
import type { AgentType } from "../agents/agent-session-commands";

// ADR-0019：displayMode 按 RedWhisk 是否已接入 JSON 解析器决定。
// codex/claude 默认 json 且可在 json/tui 间切换；opencode/grok 锁定 tui 且不可切换
// （表单隐藏切换控件，仅展示只读 tui）。本期 displayMode 为数据记录 + 扩展点，
// 不驱动后端渲染。
export interface DisplayModeDefaults {
  defaultMode: AgentDisplayMode;
  canSwitch: boolean;
}

export function getDisplayModeDefaults(
  agentType: AgentType,
): DisplayModeDefaults {
  if (agentType === "opencode" || agentType === "grok") {
    return { defaultMode: "tui", canSwitch: false };
  }
  return { defaultMode: "json", canSwitch: true };
}

// 表单内切换 agentType 时，决定下一个 displayMode：
// - 切到 opencode/grok：强制 tui（无论原值）。
// - 切到 codex/claude：若当前是 tui 则保留 tui，否则回到默认 json。
// 不直接复用 getDisplayModeDefaults.defaultMode 是因为「切换可保留已有 tui 选择」
// 比「每次切回 codex 都丢掉 tui」更符合用户预期。
export function resolveDisplayModeOnAgentTypeChange(
  nextAgentType: AgentType,
  currentDisplayMode: AgentDisplayMode,
): AgentDisplayMode {
  const resolved = getDisplayModeDefaults(nextAgentType);
  if (!resolved.canSwitch) {
    return resolved.defaultMode;
  }
  return currentDisplayMode === "tui" ? "tui" : resolved.defaultMode;
}
