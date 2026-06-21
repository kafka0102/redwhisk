// 上下文窗口用量（纯展示）。
//
// 消费 `AgentUsage`（来自 message-stream state.usage，源自
// `thread/tokenUsage/updated` 通知）。无有效 usage 时不渲染，避免初始阶段噪音。
//
// 视觉遵循 DESIGN_GUIDE：黑白灰优先、状态不只靠颜色（悬浮详情明确显示百分比）。

import type { AgentUsage } from "../agent-stream-types";

interface ComposerContextMeterProps {
  usage: AgentUsage | null;
}

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

  return (
    <span
      className="agents-composer__meter"
      aria-label={`上下文窗口已使用 ${percent}%，${used.toLocaleString()} / ${max.toLocaleString()} tokens`}
      tabIndex={0}
    >
      <span
        className="agents-composer__meter-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="agents-composer__meter-fill"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="agents-composer__meter-text">
        {`${usedLabel} / ${maxLabel}`}
      </span>
      <span className="agents-composer__meter-detail" role="tooltip">
        <span className="agents-composer__meter-detail-title">上下文窗口</span>
        <span className="agents-composer__meter-detail-percent">
          {`已使用 ${percent}%`}
        </span>
        <span className="agents-composer__meter-detail-tokens">
          {`${usedLabel} / ${maxLabel} tokens`}
        </span>
      </span>
    </span>
  );
}
