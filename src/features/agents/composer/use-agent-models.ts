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
// UI 能力（canShowModel / Think / modes 等）由 list_agent_models 一并返回，
// 前端不再维护 agent-capabilities 静态双表。
//
// 沿用项目既有范式：`isDisposed` 双标志，await 期间若已卸载则丢弃结果
// （await 期间若组件卸载则丢弃结果）。

import { useCallback, useEffect, useState } from "react";

import { listAgentModels, setAgentModel } from "../agent-session-commands";
import type { AgentModel, AgentUiCapabilities } from "../agent-stream-types";
import { getCommandErrorMessage } from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";

/** 加载失败或尚未返回时的安全占位，避免 composer 控件崩溃。 */
export const SAFE_DEFAULT_CAPABILITIES: AgentUiCapabilities = {
  modelTypeLabel: "",
  canShowModel: false,
  supportsModelSwitching: false,
  supportsReasoningEffort: false,
  supportsModes: false,
  supportsTuiResume: false,
};

interface UseAgentModelsArgs {
  projectId: number;
  sessionId: number;
  currentModelId?: string | null;
  enabled: boolean;
  onBeforeSelectModel?: () => Promise<void>;
}

export interface UseAgentModelsResult {
  models: AgentModel[];
  selectedModelId: string | null;
  isLoading: boolean;
  error: string | null;
  isReadOnly: boolean;
  /** Provider UI 能力（来自 list_agent_models）。 */
  capabilities: AgentUiCapabilities;
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
  enabled,
  onBeforeSelectModel,
}: UseAgentModelsArgs): UseAgentModelsResult {
  const { t } = useI18n();
  const [models, setModels] = useState<AgentModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [capabilities, setCapabilities] = useState<AgentUiCapabilities>(
    SAFE_DEFAULT_CAPABILITIES,
  );

  // 拉取模型列表与 UI 能力。sessionId 切换时重新加载。
  useEffect(() => {
    let isDisposed = false;

    async function loadModels() {
      if (!enabled) {
        setModels([]);
        setError(null);
        setIsLoading(false);
        setIsReadOnly(true);
        setCapabilities(SAFE_DEFAULT_CAPABILITIES);
        return;
      }
      setIsLoading(true);
      setError(null);
      setIsReadOnly(false);
      try {
        const {
          models: nextModels,
          isReadOnly: serverReadOnly,
          capabilities: nextCapabilities,
        } = await listAgentModels({
          projectId,
          sessionId,
        });
        if (isDisposed) {
          return;
        }
        setModels(nextModels);
        // 后端按第三方接口判定只读（Claude 配置了 base_url/auth_token 时为 true）。
        setIsReadOnly(serverReadOnly === true);
        setCapabilities(nextCapabilities ?? SAFE_DEFAULT_CAPABILITIES);
      } catch (loadError) {
        if (isDisposed) {
          return;
        }
        setError(getCommandErrorMessage(loadError, t));
        setCapabilities(SAFE_DEFAULT_CAPABILITIES);
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
  }, [enabled, projectId, sessionId, t]);

  // 选中值优先级：数据源 currentModelId > 列表默认。纯渲染期派生，无 setState。
  const selectedModelId = currentModelId ?? deriveDefaultModelId(models);

  const selectModel = useCallback(
    async (modelId: string) => {
      setError(null);
      try {
        await onBeforeSelectModel?.();
        await setAgentModel({ projectId, sessionId, modelId });
        // 后端经 model_changed 事件回传 currentModelId，Select 自动跟随。
      } catch (selectError) {
        setError(getCommandErrorMessage(selectError, t));
      }
    },
    [onBeforeSelectModel, projectId, sessionId, t],
  );

  return {
    models,
    selectedModelId,
    isLoading,
    error,
    isReadOnly,
    capabilities,
    selectModel,
  };
}
