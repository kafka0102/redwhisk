// 上下文窗口用量条（纯展示）。
//
// 消费 `AgentUsage`（来自 message-stream state.usage，源自
// `thread/tokenUsage/updated` 通知）。无 usage 时渲染占位「—」。
//
// 视觉遵循 DESIGN_GUIDE：黑白灰优先、状态不只靠颜色（接近上限时 fill 变色
// 且附「接近上限」文字）。

import type { AgentUsage } from "../agent-stream-types";

interface ComposerContextMeterProps {
  usage: AgentUsage | null;
}

/** 接近上限的阈值（占比 ≥ 此值进入 warning）。 */
const WARNING_RATIO = 0.8;

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
    return (
      <span
        className="agents-composer__meter agents-composer__meter--empty"
        aria-label="上下文窗口用量未知"
      >
        上下文：—
      </span>
    );
  }

  const ratio = Math.min(used / max, 1);
  const isWarning = ratio >= WARNING_RATIO;
  const percent = Math.round(ratio * 100);

  return (
    <span
      className="agents-composer__meter"
      aria-label={`上下文窗口已用 ${percent}%`}
      title={`已用 ${used.toLocaleString()} / ${max.toLocaleString()} tokens`}
    >
      <span
        className="agents-composer__meter-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={
            isWarning
              ? "agents-composer__meter-fill agents-composer__meter-fill--warning"
              : "agents-composer__meter-fill"
          }
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="agents-composer__meter-text">
        {isWarning ? "接近上限 " : ""}
        {`${formatTokens(used)} / ${formatTokens(max)}`}
      </span>
    </span>
  );
}
