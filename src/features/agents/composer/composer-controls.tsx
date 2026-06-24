// composer 控制行（纯展示）：附件图标 + 模型菜单/只读模型信息 + Think 菜单 + 发送/终止按钮 + 用量。

import { ArrowUp, Paperclip, Square } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui";
import type { AgentCapabilities } from "../agent-capabilities";
import { ComposerContextMeter } from "./composer-context-meter";
import type { AgentUsage, AgentModel } from "../agent-stream-types";
import type { ComposerEffort } from "./composer-types";

interface ComposerControlsProps {
  capabilities: AgentCapabilities;
  models: AgentModel[];
  selectedModelId: string | null;
  isLoadingModels: boolean;
  modelsError: string | null;
  isModelReadOnly: boolean;
  onSelectModel: (modelId: string) => void;
  effort: ComposerEffort;
  thinkOptions: string[];
  onSelectEffort: (effort: ComposerEffort) => void;
  isSending: boolean;
  canSend: boolean;
  isReadOnly: boolean;
  onAddAttachment: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  usage: AgentUsage | null;
}

const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const OFF_VALUE = "__off__";

export function ComposerControls({
  capabilities,
  models,
  selectedModelId,
  isLoadingModels,
  modelsError,
  isModelReadOnly,
  onSelectModel,
  effort,
  thinkOptions,
  onSelectEffort,
  isSending,
  canSend,
  isReadOnly,
  onAddAttachment,
  onSubmit,
  onCancel,
  usage,
}: ComposerControlsProps) {
  const effortValue = effort ?? OFF_VALUE;
  const hasModels = models.length > 0;
  const showModelSelect =
    capabilities.supportsModelSwitching && !isModelReadOnly;
  const showReadOnlyModel =
    isModelReadOnly || !capabilities.supportsModelSwitching;
  const showThinkSelect = capabilities.supportsReasoningEffort && !isReadOnly;
  const modelLabel = formatModelLabel(
    selectedModelId,
    models,
    fallbackModelLabel(capabilities),
  );
  const modelPlaceholder =
    modelsError ?? (isLoadingModels ? "加载中…" : "无可用模型");

  return (
    <div className="agents-composer__controls">
      <div className="agents-composer__tools">
        <button
          type="button"
          className="agents-composer__attach"
          aria-label="添加附件"
          disabled={isReadOnly}
          onClick={onAddAttachment}
        >
          <Paperclip aria-hidden="true" size={16} strokeWidth={1.9} />
        </button>

        <div className="agents-composer__selects">
          {showModelSelect && (
            <Select
              value={selectedModelId ?? ""}
              onValueChange={(value) => {
                if (typeof value === "string" && value !== "") {
                  onSelectModel(value);
                }
              }}
              disabled={isReadOnly || !hasModels || isLoadingModels}
            >
              <SelectTrigger
                id="agent-composer-model"
                aria-label="选择模型"
                className="agents-composer__select"
                size="sm"
              >
                <span data-slot="select-value">
                  {modelLabel ?? modelPlaceholder}
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="agents-composer__menu">
                {models.map((model) => (
                  <SelectItem key={model.modelId} value={model.modelId}>
                    {formatModelLabel(model.modelId, models, null)}
                    {model.isDefault ? "（默认）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {showReadOnlyModel && modelLabel ? (
            <span
              className="agents-composer__model-label"
              aria-label="当前模型类型"
            >
              {modelLabel}
            </span>
          ) : null}

          {showThinkSelect && (
            <Select
              value={effortValue}
              onValueChange={(value) => {
                if (value === OFF_VALUE) {
                  onSelectEffort(null);
                } else if (typeof value === "string") {
                  onSelectEffort(value as ComposerEffort);
                }
              }}
              disabled={isReadOnly}
            >
              <SelectTrigger
                id="agent-composer-effort"
                aria-label="Think 模式"
                className="agents-composer__select"
                size="sm"
              >
                <span data-slot="select-value">
                  {effort === null ? "关闭" : (EFFORT_LABELS[effort] ?? effort)}
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="agents-composer__menu">
                <SelectItem value={OFF_VALUE}>关闭</SelectItem>
                {thinkOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {EFFORT_LABELS[option] ?? option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="agents-composer__actions">
        <ComposerContextMeter usage={usage} />
        {isSending ? (
          <button
            type="button"
            className="agents-composer__cancel"
            aria-label="终止当前任务"
            onClick={onCancel}
          >
            <Square
              aria-hidden="true"
              size={12}
              strokeWidth={2}
              fill="currentColor"
            />
          </button>
        ) : (
          <button
            type="button"
            className="agents-composer__send"
            aria-label="发送消息"
            disabled={!canSend}
            onClick={onSubmit}
          >
            <ArrowUp aria-hidden="true" size={13} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

function fallbackModelLabel(capabilities: AgentCapabilities): string | null {
  return capabilities.modelTypeLabel;
}

function formatModelLabel(
  modelId: string | null,
  models: AgentModel[],
  fallback: string | null,
): string | null {
  if (modelId == null) {
    return fallback;
  }
  const model = models.find((candidate) => candidate.modelId === modelId);
  return normalizeModelLabel(model?.displayName ?? modelId);
}

function normalizeModelLabel(label: string): string {
  return label.replace(/^gpt\b/i, "GPT").replace(/^gpt(?=[-.0-9])/i, "GPT");
}
