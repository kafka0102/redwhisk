// 加载并管理当前 session 可用模型列表的 hook。
//
// 选中模型的数据源是父组件下传的 `currentModelId`（来自 message-stream
// state.model，由 `model_changed` 事件驱动）。本地不维护乐观覆盖：用户点选
// 新模型后只发 `setAgentModel` 命令，后端经 `model_changed` 事件回传新
// modelId，父组件更新 `currentModelId` 下传，Select 跟随刷新。这与
// agent-development-rules.md L213「前端只发 command」一致，避免本地状态与
// 数据源双写。
//
// 当 `currentModelId` 为 null（尚未收到事件）时，从模型列表派生默认值
// （isDefault 优先，否则首个）作为回退，纯渲染期计算无 setState。
//
// 沿用项目既有范式：`isDisposed` 双标志，await 期间若已卸载则丢弃结果
// （参考 `temporary-session-dialog.tsx` 的 loadProfiles）。

import { useCallback, useEffect, useState } from "react";

import { listAgentModels, setAgentModel } from "../agent-session-commands";
import type { AgentModel } from "../agent-stream-types";
import { toCommandError } from "../../../shared/commands/command-error";

interface UseAgentModelsArgs {
  projectId: number;
  sessionId: number;
  currentModelId?: string | null;
}

export interface UseAgentModelsResult {
  models: AgentModel[];
  selectedModelId: string | null;
  isLoading: boolean;
  error: string | null;
  /** 切换模型：调 setAgentModel；后端经事件回传后 Select 自动跟随。 */
  selectModel: (modelId: string) => Promise<void>;
}

/**
 * 从模型列表派生默认 modelId（isDefault 优先，否则首个）。
 * 列表为空返回 null。
 */
function deriveDefaultModelId(models: AgentModel[]): string | null {
  const defaultModel = models.find((model) => model.isDefault);
  return defaultModel?.modelId ?? models[0]?.modelId ?? null;
}

export function useAgentModels({
  projectId,
  sessionId,
  currentModelId,
}: UseAgentModelsArgs): UseAgentModelsResult {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 拉取模型列表。sessionId 切换时重新加载。
  useEffect(() => {
    let isDisposed = false;

    async function loadModels() {
      setIsLoading(true);
      setError(null);
      try {
        const { models: nextModels } = await listAgentModels({
          projectId,
          sessionId,
        });
        if (isDisposed) {
          return;
        }
        setModels(nextModels);
      } catch (loadError) {
        if (isDisposed) {
          return;
        }
        setError(toCommandError(loadError).message);
      } finally {
        if (!isDisposed) {
          setIsLoading(false);
        }
      }
    }

    void loadModels();

    return () => {
      isDisposed = true;
    };
  }, [projectId, sessionId]);

  // 选中值优先级：数据源 currentModelId > 列表默认。纯渲染期派生，无 setState。
  const selectedModelId = currentModelId ?? deriveDefaultModelId(models);

  const selectModel = useCallback(
    async (modelId: string) => {
      setError(null);
      try {
        await setAgentModel({ projectId, sessionId, modelId });
        // 后端经 model_changed 事件回传 currentModelId，Select 自动跟随。
      } catch (selectError) {
        setError(toCommandError(selectError).message);
      }
    },
    [projectId, sessionId],
  );

  return {
    models,
    selectedModelId,
    isLoading,
    error,
    selectModel,
  };
}
