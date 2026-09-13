// 按「项目 + Agent Profile」加载启动期模型候选的 hook。
//
// Run Dialog 选定 Agent 后用它取该 Agent 的本机模型目录候选（ADR-0036 第 9 条）：
// 加载中清空旧候选（不展示过期数据），失败只报错不阻断启动；默认选中后端标默认的
// 条目（无默认标记取首条）。「用户是否主动改过」由 `isTouched` 表达，未改动时启动
// 请求不携带模型字段，后端继续按 Agent 配置解析。

import { useCallback, useEffect, useState } from "react";

import { listAgentProfileModels } from "../../agents/agent-session-commands";
import type { AgentModel } from "../../agents/agent-stream-types";
import { deriveDefaultModelId } from "../../agents/agent-model-utils";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

export interface UseRunAgentModelArgs {
  projectId: number;
  /** 当前选中的 Agent Profile id；为 null 时不加载。 */
  agentProfileId: number | null;
}

export interface UseRunAgentModelResult {
  models: AgentModel[];
  isReadOnly: boolean;
  /** 默认选中项：后端标默认的条目，无默认标记时取首条。 */
  selectedModelId: string | null;
  /** 用户是否主动改过选择（未改则启动请求不携带模型字段）。 */
  isTouched: boolean;
  isLoading: boolean;
  error: string | null;
  selectModel: (modelId: string) => void;
}

export function useRunAgentModel({
  projectId,
  agentProfileId,
}: UseRunAgentModelArgs): UseRunAgentModelResult {
  const { t } = useI18n();
  const [models, setModels] = useState<AgentModel[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isTouched, setIsTouched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;
    const profileId = agentProfileId;

    async function loadModels() {
      // Profile 切换：先清空旧候选与选择，避免残留上一个 Agent 的模型。
      setModels([]);
      setIsReadOnly(false);
      setSelectedModelId(null);
      setIsTouched(false);
      setError(null);
      if (profileId === null) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const result = await listAgentProfileModels({
          projectId,
          agentProfileId: profileId,
        });
        if (isDisposed) {
          return;
        }
        setModels(result.models);
        setIsReadOnly(result.isReadOnly === true);
        setSelectedModelId(deriveDefaultModelId(result.models));
        setError(null);
      } catch (loadError) {
        if (isDisposed) {
          return;
        }
        setError(getCommandErrorMessage(loadError, t));
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
  }, [agentProfileId, projectId, t]);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    setIsTouched(true);
  }, []);

  return {
    models,
    isReadOnly,
    selectedModelId,
    isTouched,
    isLoading,
    error,
    selectModel,
  };
}
