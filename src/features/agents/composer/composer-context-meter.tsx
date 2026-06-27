// 上下文窗口用量（纯展示）。
//
// 消费 `AgentUsage`（来自 message-stream state.usage，源自
// `thread/tokenUsage/updated` 通知）。无有效 usage 时不渲染，避免初始阶段噪音。
//
// 视觉遵循 DESIGN_GUIDE：黑白灰优先、状态不只靠颜色（悬浮详情明确显示百分比）。

import type { AgentUsage } from "../agent-stream-types";
import { useI18n } from "../../../shared/i18n/i18n";

interface ComposerContextMeterProps {
  usage: AgentUsage | null;
}

const METER_SIZE = 18;
const METER_CENTER = METER_SIZE / 2;
const METER_STROKE_WIDTH = 3;
const METER_RING_RADIUS = 7;
const METER_OUTER_OUTLINE_RADIUS = METER_RING_RADIUS + METER_STROKE_WIDTH / 2;
const METER_INNER_OUTLINE_RADIUS = METER_RING_RADIUS - METER_STROKE_WIDTH / 2;

/** 把 token 数格式化为 k 简写（如 12300 → "12.3k"，<1000 原样）。 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    // 整数 k 不带小数，避免 "12.0k"。
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(tokens);
}

export function ComposerContextMeter({ usage }: ComposerContextMeterProps) {
  const { messages } = useI18n();
  const used = usage?.contextWindowUsedTokens;
  const max = usage?.contextWindowMaxTokens;

  const hasData = used != null && max != null && max > 0;
  if (!hasData) {
    return null;
  }

  const ratio = Math.min(used / max, 1);
  const percent = Math.round(ratio * 100);
  const usedLabel = formatTokens(used);
  const maxLabel = formatTokens(max);
  const progressLabel = `${messages.agentsFeature.contextWindow} ${percent}%`;

  return (
    <span className="agents-composer__meter" tabIndex={0}>
      <span
        className="agents-composer__meter-ring"
        role="progressbar"
        aria-label={progressLabel}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <svg
          className="agents-composer__meter-svg"
          viewBox={`0 0 ${METER_SIZE} ${METER_SIZE}`}
          aria-hidden="true"
        >
          <circle
            className="agents-composer__meter-outline"
            cx={METER_CENTER}
            cy={METER_CENTER}
            r={METER_OUTER_OUTLINE_RADIUS}
          />
          <circle
            className="agents-composer__meter-track"
            cx={METER_CENTER}
            cy={METER_CENTER}
            r={METER_RING_RADIUS}
          />
          <circle
            className="agents-composer__meter-progress"
            cx={METER_CENTER}
            cy={METER_CENTER}
            r={METER_RING_RADIUS}
            pathLength={100}
            strokeDasharray={`${percent} 100`}
          />
          <circle
            className="agents-composer__meter-outline"
            cx={METER_CENTER}
            cy={METER_CENTER}
            r={METER_INNER_OUTLINE_RADIUS}
          />
        </svg>
      </span>
      <span className="agents-composer__meter-detail" role="tooltip">
        <span className="agents-composer__meter-detail-title">
          {messages.agentsFeature.contextWindow}
        </span>
        <span className="agents-composer__meter-detail-percent">
          {messages.agentsFeature.contextUsed(percent)}
        </span>
        <span className="agents-composer__meter-detail-tokens">
          {`${usedLabel} / ${maxLabel} tokens`}
        </span>
      </span>
    </span>
  );
}
