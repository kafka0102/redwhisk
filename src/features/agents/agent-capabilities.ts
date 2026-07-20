// Agent 能力声明（前端常量表）。
//
// composer 等组件据此决定是否渲染模型切换 / Think 模式 / 协作模式等控件。
// 能力基本静态（取决于 agent 协议是否支持），故用常量表而非后端命令查询，
// 避免额外往返。新增 Claude 等实现时按实际能力调整对应条目。

import type { AgentType } from "./agent-session-commands";

export interface AgentCapabilities {
  /** 当前 agent/provider 的只读模型类型标签。 */
  modelTypeLabel: string;
  /**
   * 是否在 composer 展示模型信息（下拉或只读标签）。
   *
   * Codex 与 Claude 均为 true：模型来源由后端 list_agent_models 按 agent 类型
   * 解析（Codex 写死，Claude 读 ~/.claude/settings.json）。
   */
  canShowModel: boolean;
  /** 是否支持运行时切换模型。 */
  supportsModelSwitching: boolean;
  /** 是否支持 reasoning effort（Think 模式）。 */
  supportsReasoningEffort: boolean;
  /** 是否支持协作模式切换（auto / full-access / read-only 等）。 */
  supportsModes: boolean;
}

const AGENT_CAPABILITIES: Record<AgentType, AgentCapabilities> = {
  codex: {
    modelTypeLabel: "Codex",
    canShowModel: true,
    supportsModelSwitching: true,
    supportsReasoningEffort: true,
    supportsModes: true,
  },
  claude: {
    modelTypeLabel: "Claude",
    // Claude 也展示模型：第三方接口只读标签，官方模型可切换。
    canShowModel: true,
    supportsModelSwitching: true,
    supportsReasoningEffort: false,
    supportsModes: false,
  },
  claude_code: {
    modelTypeLabel: "Claude",
    canShowModel: true,
    supportsModelSwitching: true,
    supportsReasoningEffort: false,
    supportsModes: false,
  },
  // ADR-0019：opencode/grok 本期仅登记展示，不接入会话执行（无 JSON 解析器）。
  // 能力全部置 false，确保 composer 不会为它们渲染模型/思考/模式控件。
  // 待后续 ticket 接入解析器时按实际能力补齐。
  opencode: {
    modelTypeLabel: "OpenCode",
    canShowModel: false,
    supportsModelSwitching: false,
    supportsReasoningEffort: false,
    supportsModes: false,
  },
  grok: {
    modelTypeLabel: "Grok",
    canShowModel: false,
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
