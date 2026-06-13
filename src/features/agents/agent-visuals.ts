import claudeLogoSrc from "../../assets/images/claude.svg";
import codexLogoSrc from "../../assets/images/codex.svg";

export type VisualAgentType = "codex" | "claude" | "claude_code" | string;

export function formatAgentTypeLabel(agentType: VisualAgentType): string {
  switch (agentType) {
    case "codex":
      return "Codex";
    case "claude":
    case "claude_code":
      return "Claude";
    default:
      return agentType;
  }
}

export function getAgentLogoSrc(agentType: VisualAgentType): string {
  if (agentType === "claude" || agentType === "claude_code") {
    return claudeLogoSrc;
  }

  return codexLogoSrc;
}
