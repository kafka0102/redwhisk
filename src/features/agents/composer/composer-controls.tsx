// composer 控制行（纯展示）：附件图标 + 模型菜单/只读模型信息 + Think 菜单 + 发送/终止按钮 + 用量。

import { ArrowUp, Paperclip, Square } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui";
import { useI18n } from "../../../shared/i18n/i18n";
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
  xhigh: "超高",
};

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
  const { messages } = useI18n();
  const currentModel = models.find(
    (model) => model.modelId === selectedModelId,
  );
  const effortValue =
    effort ?? currentModel?.defaultReasoningEffort ?? thinkOptions[0] ?? "";
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
    modelsError ??
    (isLoadingModels ? messages.settings.loading : messages.settings.none);

  return (
    <div className="agents-composer__controls">
      <div className="agents-composer__tools">
        <button
          type="button"
          className="agents-composer__attach"
          aria-label={messages.agentsFeature.addAttachment}
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
                aria-label={messages.agentsFeature.selectModel}
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
                    {model.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {showReadOnlyModel && modelLabel ? (
            <span
              className="agents-composer__model-label"
              aria-label={messages.agentsFeature.currentModelType}
            >
              {modelLabel}
            </span>
          ) : null}

          {showThinkSelect && (
            <Select
              value={effortValue}
              onValueChange={(value) => {
                if (typeof value === "string" && value !== "") {
                  onSelectEffort(value as ComposerEffort);
                }
              }}
              disabled={isReadOnly}
            >
              <SelectTrigger
                id="agent-composer-effort"
                aria-label={messages.agentsFeature.thinkMode}
                className="agents-composer__select"
                size="sm"
              >
                <span data-slot="select-value">
                  {EFFORT_LABELS[effortValue] ?? effortValue}
                </span>
              </SelectTrigger>
              <SelectContent align="start" className="agents-composer__menu">
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
            aria-label={messages.agentsFeature.cancelCurrentTurn}
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
            aria-label={messages.agentsFeature.sendMessage}
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
