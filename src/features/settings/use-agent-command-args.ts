import { useEffect, useState } from "react";

import {
  previewAgentCommandArgs,
  type AgentProfileRecord,
} from "./settings-commands";

export type AgentCommandArgsMap = Map<number, string[]>;

interface UseAgentCommandArgsResult {
  argsByProfileId: AgentCommandArgsMap;
}

const EMPTY_MAP: AgentCommandArgsMap = new Map();

// ADR-0019 决策 8：表格命令列「i」Tooltip 图标仅在该 profile 启动存在参数时显示。
// 本 hook 集中批量获取当前可见 profiles 的启动参数，避免每行重复 invoke 与
// 过度渲染。失败时保持空 map（i 图标不显示），不阻塞表格渲染。
//
// 调用方需保证 profiles 引用稳定（内容不变时引用不变，例如 useMemo）。
// effect 直接依赖 profiles；内容未变时不会重跑。profiles 为空时跳过请求，
// 通过派生值返回空 map，避免 effect 内同步 setState 触发级联渲染。
export function useAgentCommandArgs(
  profiles: readonly AgentProfileRecord[],
): UseAgentCommandArgsResult {
  const [argsByProfileId, setArgsByProfileId] = useState<AgentCommandArgsMap>(
    () => new Map(),
  );

  useEffect(() => {
    if (profiles.length === 0) return;
    let cancelled = false;
    void Promise.all(
      profiles.map((profile) =>
        previewAgentCommandArgs({
          agentType: profile.agentType,
          command: profile.command,
          mode: profile.mode,
          dangerous: profile.dangerous,
        }).then((args) => [profile.id, args] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setArgsByProfileId(new Map(entries));
      })
      .catch(() => {
        if (cancelled) return;
        setArgsByProfileId(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [profiles]);

  return {
    argsByProfileId: profiles.length === 0 ? EMPTY_MAP : argsByProfileId,
  };
}
