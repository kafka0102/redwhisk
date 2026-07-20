import type { AgentProfileRecord } from "../settings/settings-commands";

// ADR-0019 决策 4/5：会话入口（侧栏「+」菜单 / 临时会话 / Issue Run）选择列表
// 的可见性与可选择性判定。抽纯函数便于单元测试，三个入口共用，避免 UI 层散落
// 分支。规则：
// - enabled=false → 完全隐藏（前端过滤；后端不校验）。
// - agentType=opencode/grok → 显示但置灰「暂不支持启动」不可选（本期不接解析器）。
// - 其它（codex/claude/claude_code）且 enabled=true → 正常可选。
export type AgentProfileLaunchNote = "unsupportedLaunch";

export interface AgentProfileLaunchEligibility {
  /** 是否在选择列表中可见（enabled=false 时前端隐藏）。 */
  visible: boolean;
  /** 可见时是否可选（opencode/grok 本期不可选）。 */
  selectable: boolean;
  /** 可见但不可选时的标注 i18n key 后缀；无需标注为 null。 */
  note: AgentProfileLaunchNote | null;
}

export function resolveAgentProfileLaunchEligibility(
  profile: AgentProfileRecord,
): AgentProfileLaunchEligibility {
  if (!profile.enabled) {
    return { visible: false, selectable: false, note: null };
  }
  if (profile.agentType === "opencode" || profile.agentType === "grok") {
    return { visible: true, selectable: false, note: "unsupportedLaunch" };
  }
  return { visible: true, selectable: true, note: null };
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
// 调用方据此设置初始 selectedProfileId，避免默认落到 opencode/grok 不可选项。
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
