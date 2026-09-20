# 0038. 运行参数模型在 Session 启动时落成快照

**状态**：采纳（待执行）

启动期模型选择按 [ADR-0036](./0036-agent-model-list-from-local-config.md) 仍不写回 Agent 全局配置、不记入 Profile。但 Issue 详情与 Session 页运行参数需要在重启后仍能展示本次启动所用模型，因此在 **Agent Session 记录**上保存启动时认定的运行参数模型。

## 决定

1. **认定时机是启动**：有启动期模型选择则用它；未指定则取该 Agent 启动时刻的当前模型；都没有则存空，界面显示横线。
2. **只记 Session，不改全局**：快照属于该次 Agent Session，不写回本机配置，也不改 Profile。
3. **认定后冻结**：会话内切换模型、之后改本机默认模型，都不改写这项。运行参数展示的是启动快照，不是 composer 里的当前模型。

## 后果

- ADR-0036 的「不写回全局配置 / 不记入 Profile」仍成立；其「启动模型不落库」收窄为「不落 Profile / 全局」，Session 记录可以保存快照。
- 历史 Session 没有快照时显示横线，不做回填。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 每次打开再读 Agent 当前配置 | 重启后本机默认模型可能已变，运行参数不再是「这次启动用的模型」 |
| 跟随会话内 `model_changed` | 运行参数其它项都是启动快照；当前模型已在 composer，不应混进运行参数 |
| 继续完全不落库 | 关机后无法在 Issue 详情展示本次启动模型 |

## 代码事实来源

- 本决策：`docs/adr/0038-session-startup-model-snapshot.md`
- 前置：[ADR-0036](./0036-agent-model-list-from-local-config.md)
- 运行参数 UI：`src/features/issues/issue-detail/issue-readonly-session-panel.tsx`、`src/features/agents/session-side-panel/session-issue-panel.tsx`
