import type { AgentProfileRecord, AgentType } from "./settings-commands";

// 临时产品收缩：只隐藏页面入口，不改变 AgentType、provider 或存量数据。
const HIDDEN_AGENT_PROFILE_TYPES: ReadonlySet<AgentType> = new Set([
  "deepseek",
]);

export function isAgentProfileTypeVisible(agentType: AgentType): boolean {
  return !HIDDEN_AGENT_PROFILE_TYPES.has(agentType);
}

export function filterVisibleAgentProfiles(
  profiles: readonly AgentProfileRecord[],
): AgentProfileRecord[] {
  return profiles.filter((profile) =>
    isAgentProfileTypeVisible(profile.agentType),
  );
}

// 可见行只在原可见槽位间重排；隐藏行保留完整顺序中的相对位置。
export function mergeVisibleAgentOrderIntoAllProfiles(
  profiles: readonly AgentProfileRecord[],
  orderedVisibleIds: readonly number[],
): number[] {
  const visibleIds = new Set(
    profiles
      .filter((profile) => isAgentProfileTypeVisible(profile.agentType))
      .map((profile) => profile.id),
  );
  const nextVisibleIds = orderedVisibleIds.filter((id) => visibleIds.has(id));
  let visibleIndex = 0;

  return profiles.map((profile) => {
    if (!visibleIds.has(profile.id)) {
      return profile.id;
    }
    const nextId = nextVisibleIds[visibleIndex];
    visibleIndex += 1;
    return nextId ?? profile.id;
  });
}
