// Agent 模型候选的纯工具（composer 与 Run Dialog 共用，避免两份默认派生逻辑）。

import type { AgentModel } from "./agent-stream-types";

/** 从模型列表派生默认 modelId（isDefault 优先，否则取首个）；列表为空返回 null。 */
export function deriveDefaultModelId(models: AgentModel[]): string | null {
  const defaultModel = models.find((model) => model.isDefault);
  return defaultModel?.modelId ?? models[0]?.modelId ?? null;
}

/** 展示发给 LLM 的模型参数；目录没有单独 wire 时回退配置名 / 模型 id。 */
export function modelWireLabel(
  model: Pick<AgentModel, "modelId" | "wireModel"> | null | undefined,
  fallbackId: string | null,
): string | null {
  const wire = model?.wireModel?.trim();
  if (wire) {
    return wire;
  }
  return fallbackId;
}
