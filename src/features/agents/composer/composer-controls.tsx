// composer 控制行（纯展示）：附件图标 + 模型菜单 + Think 菜单 + 发送/取消按钮 + 用量条。
//
// 模型与 Think 都用 shadcn Select（base-ui）。Think 只展示 low/medium/high/xhigh，
// 不提供关闭项。

import { ArrowUp, Paperclip, Square } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  onSelectModel: (modelId: string) => void;
  effort: ComposerEffort;
  thinkOptions: string[];
  onSelectEffort: (effort: ComposerEffort) => void;
  isSending: boolean;
  canSend: boolean;
  onAddAttachment: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  usage: AgentUsage | null;
}

const EFFORT_LABELS: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
};

export function ComposerControls({
  capabilities,
  models,
  selectedModelId,
  isLoadingModels,
  modelsError,
  onSelectModel,
  effort,
  thinkOptions,
  onSelectEffort,
  isSending,
  canSend,
  onAddAttachment,
  onSubmit,
  onCancel,
  usage,
}: ComposerControlsProps) {
  const hasModels = models.length > 0;
  const showModelSelect = capabilities.supportsModelSwitching;
  const showThinkSelect = capabilities.supportsReasoningEffort;

  return (
    <div className="agents-composer__controls">
      <div className="agents-composer__tools">
        <button
          type="button"
          className="agents-composer__attach"
          aria-label="添加附件"
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
              disabled={!hasModels || isLoadingModels}
            >
              <SelectTrigger
                id="agent-composer-model"
                aria-label="选择模型"
                className="agents-composer__select"
                size="sm"
              >
                <SelectValue
                  placeholder={
                    modelsError ?? (isLoadingModels ? "加载中…" : "无可用模型")
                  }
                />
              </SelectTrigger>
              <SelectContent align="start" className="agents-composer__menu">
                {models.map((model) => (
                  <SelectItem key={model.modelId} value={model.modelId}>
                    {model.displayName ?? model.modelId}
                    {model.isDefault ? "（默认）" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {showThinkSelect && (
            <Select
              value={effort}
              onValueChange={(value) => {
                if (typeof value === "string") {
                  onSelectEffort(value as ComposerEffort);
                }
              }}
            >
              <SelectTrigger
                id="agent-composer-effort"
                aria-label="Think 模式"
                className="agents-composer__select"
                size="sm"
              >
                <SelectValue />
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
            aria-label="取消当前回复"
            onClick={onCancel}
          >
            <Square
              aria-hidden="true"
              size={13}
              strokeWidth={2}
              fill="currentColor"
            />
            <span>停止</span>
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
            <span>发送</span>
          </button>
        )}
      </div>
    </div>
  );
}
