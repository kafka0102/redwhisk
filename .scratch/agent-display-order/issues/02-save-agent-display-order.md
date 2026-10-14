# 02: 松手保存整份智能体显示顺序

**What to build:** 用户在设置页把智能体拖到新位置并松手后，这份全应用顺序立刻被记住。如果提交的 id 有缺失、重复或未知，顺序不被改写，调用方能看到失败。

**Blocked by:** 01: 持久化智能体显示顺序并按它返回列表

**Status:** done

- [x] 提交当前全部未删除 profile 的 id 顺序后，之后的列表按该顺序返回
- [x] 顺序可以让项目级与全局级穿插，也可以把禁用 profile 放在任意位置
- [x] 缺少未删除 profile、包含重复 id、包含未知 id 或包含已软删 id 时，拒绝保存且原顺序不变
- [x] 保存成功后，其他项目再次列出智能体时看到同一份顺序

## Comments

粒度假设：本票只打通「提交完整顺序并持久化」这条行为，设置页握柄留到下一票。这样后端契约可以独立验收，界面票只消费它。

实现 `save_agent_display_order`：入参 `profileIds` 必须正好是全部未删除 profile。缺失、重复、未知或已软删时返回既有 `AgentProfileValidationFailed`（`agentDisplayOrderMismatch`），不改原顺序。成功后项目级与全局级列表按这份全应用顺序返回。
