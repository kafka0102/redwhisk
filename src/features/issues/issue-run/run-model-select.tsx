// Run Dialog 的启动期模型下拉（独立单元，避免继续撑大 Run Dialog 主文件）。
// 展示规则（ADR-0036 第 9 条）：候选 >=2 条且列表非只读才渲染下拉；1 条 / 0 条 /
// 只读整块不渲染；加载中显示占位；加载失败显示错误文案但不阻断启动。
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "../../../shared/i18n/i18n";
import type { AgentModel } from "../../agents/agent-stream-types";

interface RunModelSelectProps {
  models: AgentModel[];
  isReadOnly: boolean;
  selectedModelId: string | null;
  isLoading: boolean;
  error: string | null;
  disabled: boolean;
  onSelectModel: (modelId: string) => void;
}

export function RunModelSelect({
  models,
  isReadOnly,
  selectedModelId,
  isLoading,
  error,
  disabled,
  onSelectModel,
}: RunModelSelectProps) {
  const { messages } = useI18n();

  if (error) {
    return (
      <p className="text-xs text-destructive" role="status">
        {messages.agentsFeature.modelLoadFailed(error)}
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-1.5">
        <Label
          htmlFor="run-agent-model"
          className="text-xs text-muted-foreground"
        >
          {messages.agentsFeature.selectModel}
        </Label>
        <Select disabled value="">
          <SelectTrigger
            id="run-agent-model"
            aria-label={messages.agentsFeature.selectModel}
            className="w-full"
          >
            <SelectValue placeholder={messages.settings.loading} />
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>
    );
  }

  if (models.length < 2 || isReadOnly) {
    return null;
  }

  const selectedLabel =
    models.find((model) => model.modelId === selectedModelId)?.displayName ??
    selectedModelId ??
    "";

  return (
    <div className="grid gap-1.5">
      <Label
        htmlFor="run-agent-model"
        className="text-xs text-muted-foreground"
      >
        {messages.agentsFeature.selectModel}
      </Label>
      <Select
        value={selectedModelId ?? ""}
        onValueChange={(value) => {
          if (typeof value === "string" && value !== "") {
            onSelectModel(value);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id="run-agent-model"
          aria-label={messages.agentsFeature.selectModel}
          className="w-full"
        >
          <span data-slot="select-value">{selectedLabel}</span>
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.modelId} value={model.modelId}>
              {model.displayName ?? model.modelId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
