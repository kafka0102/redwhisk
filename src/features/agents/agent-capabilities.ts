// Agent 能力声明（前端常量表）。
//
// composer 等组件据此决定是否渲染模型切换 / Think 模式 / 协作模式等控件。
// 能力基本静态（取决于 agent 协议是否支持），故用常量表而非后端命令查询，
// 避免额外往返。新增 Claude 等实现时按实际能力调整对应条目。

import type { AgentType } from "./agent-session-commands";

export interface AgentCapabilities {
  /** 是否支持运行时切换模型。 */
  supportsModelSwitching: boolean;
  /** 是否支持 reasoning effort（Think 模式）。 */
  supportsReasoningEffort: boolean;
  /** 是否支持协作模式切换（auto / full-access / read-only 等）。 */
  supportsModes: boolean;
}

const AGENT_CAPABILITIES: Record<AgentType, AgentCapabilities> = {
  codex: {
    supportsModelSwitching: true,
    supportsReasoningEffort: true,
    supportsModes: true,
  },
  claude: {
    supportsModelSwitching: false,
    supportsReasoningEffort: false,
    supportsModes: false,
  },
  claude_code: {
    supportsModelSwitching: false,
    supportsReasoningEffort: false,
    supportsModes: false,
  },
};

const DEFAULT_CAPABILITIES: AgentCapabilities = AGENT_CAPABILITIES.codex;

/**
 * 取指定 agent 类型的能力声明。未知类型回退到 Codex（当前唯一实现）。
 */
export function getAgentCapabilities(agentType: AgentType): AgentCapabilities {
  return AGENT_CAPABILITIES[agentType] ?? DEFAULT_CAPABILITIES;
}
