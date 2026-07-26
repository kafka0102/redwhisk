import type { AgentType, SavedAgentSkillPath } from "./settings-commands";

/** 列表与表单中 Agent 的固定展示顺序（ADR-0025）。 */
export const SUPPORTED_AGENT_DISPLAY_ORDER = [
  "codex",
  "claude",
  "opencode",
  "grok",
] as const;

export type SupportedAgentDisplayType =
  (typeof SUPPORTED_AGENT_DISPLAY_ORDER)[number];

export interface SkillPathEntry {
  agentType: string;
  path: string;
}

export interface SupportedAgentGroup {
  agentType: string;
  paths: string[];
}

export function normalizeSkillAgentType(agentType: string): string {
  if (agentType === "claude_code") {
    return "claude";
  }
  return agentType;
}

function agentDisplayRank(agentType: string): number {
  const normalized = normalizeSkillAgentType(agentType);
  const index = (SUPPORTED_AGENT_DISPLAY_ORDER as readonly string[]).indexOf(
    normalized,
  );
  return index === -1 ? SUPPORTED_AGENT_DISPLAY_ORDER.length : index;
}

/**
 * 将 skill_paths 按 Agent 去重分组，固定顺序 Codex→Claude→OpenCode→Grok；
 * 未知 agentType 排在已知之后并按名称排序。同一 Agent 多路径全部保留在 paths。
 */
export function groupSupportedAgents(
  paths: readonly SkillPathEntry[],
): SupportedAgentGroup[] {
  const grouped = new Map<string, string[]>();

  for (const entry of paths) {
    const agentType = normalizeSkillAgentType(entry.agentType);
    const existing = grouped.get(agentType) ?? [];
    if (!existing.includes(entry.path)) {
      existing.push(entry.path);
    }
    grouped.set(agentType, existing);
  }

  const ordered: SupportedAgentGroup[] = [];
  for (const agentType of SUPPORTED_AGENT_DISPLAY_ORDER) {
    const agentPaths = grouped.get(agentType);
    if (!agentPaths || agentPaths.length === 0) {
      continue;
    }
    ordered.push({ agentType, paths: agentPaths });
    grouped.delete(agentType);
  }

  const remaining = [...grouped.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const agentType of remaining) {
    const agentPaths = grouped.get(agentType);
    if (!agentPaths || agentPaths.length === 0) {
      continue;
    }
    ordered.push({ agentType, paths: agentPaths });
  }

  return ordered;
}

/** 表单只读路径区：按 Agent 固定顺序排列每条路径（同 Agent 可多行）。 */
export function orderSkillPathEntries(
  paths: readonly SkillPathEntry[],
): SavedAgentSkillPath[] {
  return [...paths]
    .map((entry) => ({
      agentType: entry.agentType as AgentType,
      path: entry.path,
    }))
    .sort((left, right) => {
      const rankDiff =
        agentDisplayRank(left.agentType) - agentDisplayRank(right.agentType);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      const agentDiff = normalizeSkillAgentType(left.agentType).localeCompare(
        normalizeSkillAgentType(right.agentType),
      );
      if (agentDiff !== 0) {
        return agentDiff;
      }
      return left.path.localeCompare(right.path);
    });
}
