// composer 控制行（纯展示）：模型 Select + Think Select + 发送/取消按钮 + 用量条。
//
// 模型与 Think 都用 shadcn Select（base-ui），复用 temporary-session-dialog 的
// dynamic-options 模式。Think 选项从当前模型的 `supportedReasoningEfforts` 取，
// 空则回退 low/medium/high；额外提供「关闭」选项（effort=null）。

import { ArrowUp, Square } from "lucide-react";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { ComposerContextMeter } from "./composer-context-meter";
import type { AgentUsage, AgentModel } from "../agent-stream-types";
import type { ComposerEffort } from "./composer-types";

interface ComposerControlsProps {
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
  onSubmit,
  onCancel,
  usage,
}: ComposerControlsProps) {
  const effortValue = effort ?? OFF_VALUE;
  const hasModels = models.length > 0;

  return (
    <div className="agents-composer__controls">
      <div className="agents-composer__selects">
        <div className="agents-composer__field">
          <Label
            htmlFor="agent-composer-model"
            className="agents-composer__field-label"
          >
            模型
          </Label>
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
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.modelId} value={model.modelId}>
                  {model.displayName ?? model.modelId}
                  {model.isDefault ? "（默认）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="agents-composer__field">
          <Label
            htmlFor="agent-composer-effort"
            className="agents-composer__field-label"
          >
            Think
          </Label>
          <Select
            value={effortValue}
            onValueChange={(value) => {
              if (value === OFF_VALUE) {
                onSelectEffort(null);
              } else if (typeof value === "string") {
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
            <SelectContent>
              <SelectItem value={OFF_VALUE}>关闭</SelectItem>
              {thinkOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {EFFORT_LABELS[option] ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
