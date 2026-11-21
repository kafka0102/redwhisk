import type { AgentType } from "./agent-type";

// 临时产品收缩：只隐藏页面入口，不改变 AgentType、provider 或存量数据。
const HIDDEN_AGENT_PROFILE_TYPES: ReadonlySet<AgentType> = new Set([
  "deepseek",
]);

export function isAgentProfileTypeVisible(agentType: AgentType): boolean {
  return !HIDDEN_AGENT_PROFILE_TYPES.has(agentType);
}
