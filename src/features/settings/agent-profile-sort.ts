import type { AgentProfileRecord } from "./settings-commands";

// ADR-0019 决策 9：表格排序——enabled=true 组在前、enabled=false 置末；
// 同 enabled 组内按 id 升序（保留既有 project/global 合并按 id 排序的语义）。
// 抽纯函数便于单元测试，避免依赖 React 渲染。
export function compareAgentProfilesForDisplay(
  left: AgentProfileRecord,
  right: AgentProfileRecord,
): number {
  if (left.enabled !== right.enabled) {
    return left.enabled ? -1 : 1;
  }
  return left.id - right.id;
}

// 返回新数组，不修改入参；调用方直接替换 `.sort(idComparator)` 即可。
export function sortAgentProfilesForDisplay(
  profiles: readonly AgentProfileRecord[],
): AgentProfileRecord[] {
  return [...profiles].sort(compareAgentProfilesForDisplay);
}
