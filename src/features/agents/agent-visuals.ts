import claudeLogoSrc from "../../assets/images/claude.svg";
import codexLogoSrc from "../../assets/images/codex.svg";
import grokLogoSrc from "../../assets/images/grok.svg";
import opencodeLogoSrc from "../../assets/images/opencode.svg";

export type VisualAgentType =
  | "codex"
  | "claude"
  | "claude_code"
  | "opencode"
  | "grok"
  | string;

// 展示文案映射。未登记的 agentType 回退为原值，便于排查未覆盖的枚举。
const AGENT_TYPE_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  claude_code: "Claude",
  opencode: "OpenCode",
  grok: "Grok",
};

// Logo 映射。未登记的 agentType 回退到 codex logo（既有默认行为，避免渲染空白）。
const AGENT_TYPE_LOGOS: Record<string, string> = {
  codex: codexLogoSrc,
  claude: claudeLogoSrc,
  claude_code: claudeLogoSrc,
  opencode: opencodeLogoSrc,
  grok: grokLogoSrc,
};

export function formatAgentTypeLabel(agentType: VisualAgentType): string {
  return AGENT_TYPE_LABELS[agentType] ?? agentType;
}

export function getAgentLogoSrc(agentType: VisualAgentType): string {
  return AGENT_TYPE_LOGOS[agentType] ?? codexLogoSrc;
}
