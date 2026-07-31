import type { AgentProfileRecord } from "../settings/settings-commands";

// 会话入口（Issue Run 等）选择列表的可见性与可选择性判定。
// 抽纯函数便于单元测试，多入口共用，避免 UI 层散落分支。规则：
// - enabled=false → 完全隐藏（前端过滤；后端不校验）。
// - enabled=true → 正常可选（含 Codex / Claude / OpenCode / Grok，Grok 为 TUI-only）。
export interface AgentProfileLaunchEligibility {
  /** 是否在选择列表中可见（enabled=false 时前端隐藏）。 */
  visible: boolean;
  /** 是否可选（与 visible 当前等价，仅 enabled=true 时可选）。 */
  selectable: boolean;
}

export function resolveAgentProfileLaunchEligibility(
  profile: AgentProfileRecord,
): AgentProfileLaunchEligibility {
  if (!profile.enabled) {
    return { visible: false, selectable: false };
  }
  return { visible: true, selectable: true };
}

// 渲染选择列表前的过滤：剔除 enabled=false 的项。
// 返回新数组，不修改入参。
export function filterLaunchVisibleAgentProfiles(
  profiles: readonly AgentProfileRecord[],
): AgentProfileRecord[] {
  return profiles.filter(
    (profile) => resolveAgentProfileLaunchEligibility(profile).visible,
  );
}

// 取默认选中 profile：首个「可选」项；无则 null。
export function pickDefaultLaunchSelectableProfile(
  profiles: readonly AgentProfileRecord[],
): AgentProfileRecord | null {
  for (const profile of profiles) {
    if (resolveAgentProfileLaunchEligibility(profile).selectable) {
      return profile;
    }
  }
  return null;
}
