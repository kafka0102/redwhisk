import type { AgentProfileRecord } from "./settings-commands";

// ADR-0051：列表接口已按智能体显示顺序返回。项目级与全局级按该顺序穿插，
// 不再按启用状态或 id 重排。
export function mergeAgentProfilesByDisplayOrder(
  projectProfiles: readonly AgentProfileRecord[],
  globalProfiles: readonly AgentProfileRecord[],
): AgentProfileRecord[] {
  return [...projectProfiles, ...globalProfiles].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
}
