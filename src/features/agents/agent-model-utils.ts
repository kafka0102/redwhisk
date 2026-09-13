// Agent 模型候选的纯工具（composer 与 Run Dialog 共用，避免两份默认派生逻辑）。

import type { AgentModel } from "./agent-stream-types";

/** 从模型列表派生默认 modelId（isDefault 优先，否则取首个）；列表为空返回 null。 */
export function deriveDefaultModelId(models: AgentModel[]): string | null {
  const defaultModel = models.find((model) => model.isDefault);
  return defaultModel?.modelId ?? models[0]?.modelId ?? null;
}
