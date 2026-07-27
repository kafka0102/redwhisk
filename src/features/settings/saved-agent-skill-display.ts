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

/** 共享 agents 根目录片段。 */
const SHARED_AGENTS_SKILLS_ROOT = ".agents/skills";

/**
 * Agent 专属 skill 根（路径片段）。展示优先级：
 * 专属 → `.agents/skills` → 其他共享 → 其余。
 */
const DEDICATED_SKILL_ROOTS: Readonly<Record<string, readonly string[]>> = {
  codex: [".codex/skills", ".codex/superpowers/skills", "etc/codex/skills"],
  claude: [".claude/skills"],
  opencode: [".opencode/skills", ".config/opencode/skills"],
  grok: [".grok/skills"],
};

/** 其他共享根（对非专属 Agent 而言，如 OpenCode/Grok 下的 `.claude/skills`）。 */
const OTHER_SHARED_SKILL_ROOTS = [".claude/skills"] as const;

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

/** 判断 path 是否落在给定 skill 根目录片段下（兼容绝对路径）。 */
function pathMatchesSkillRoot(path: string, rootFragment: string): boolean {
  const normalized = normalizePathSeparators(path);
  const fragment = normalizePathSeparators(rootFragment).replace(
    /^\/+|\/+$/g,
    "",
  );
  if (fragment.length === 0) {
    return false;
  }
  return (
    normalized === fragment ||
    normalized.startsWith(`${fragment}/`) ||
    normalized.includes(`/${fragment}/`) ||
    normalized.endsWith(`/${fragment}`)
  );
}

/** 路径根类型优先级：0 专属根 → 1 `.agents/skills` → 2 其他共享根 → 3 其余。 */
function skillPathPriorityRank(agentType: string, path: string): number {
  const normalizedAgent = normalizeSkillAgentType(agentType);
  const dedicatedRoots = DEDICATED_SKILL_ROOTS[normalizedAgent] ?? [];
  if (dedicatedRoots.some((root) => pathMatchesSkillRoot(path, root))) {
    return 0;
  }
  if (pathMatchesSkillRoot(path, SHARED_AGENTS_SKILLS_ROOT)) {
    return 1;
  }
  if (
    OTHER_SHARED_SKILL_ROOTS.some(
      (root) =>
        pathMatchesSkillRoot(path, root) && !dedicatedRoots.includes(root),
    )
  ) {
    return 2;
  }
  return 3;
}

/**
 * 在同一 agentType 的多条路径中选出展示用 preferred path。
 * 同优先级取路径字符串字典序第一条；无路径返回 null。
 */
export function selectPreferredSkillPath(
  agentType: string,
  paths: readonly string[],
): string | null {
  if (paths.length === 0) {
    return null;
  }
  const uniquePaths = [...new Set(paths)];
  uniquePaths.sort((left, right) => {
    const rankDiff =
      skillPathPriorityRank(agentType, left) -
      skillPathPriorityRank(agentType, right);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return left.localeCompare(right);
  });
  return uniquePaths[0] ?? null;
}

/**
 * 表单只读路径区：每个 Agent 仅一行 preferred path，顺序与列表徽章一致。
 * 不影响保存时提交的完整 skill_paths。
 */
export function preferredSkillPathEntries(
  paths: readonly SkillPathEntry[],
): SavedAgentSkillPath[] {
  return groupSupportedAgents(paths).flatMap((group) => {
    const preferred = selectPreferredSkillPath(group.agentType, group.paths);
    if (!preferred) {
      return [];
    }
    return [
      {
        agentType: group.agentType as AgentType,
        path: preferred,
      },
    ];
  });
}
