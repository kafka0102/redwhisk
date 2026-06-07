# Session 自动 Attention 与圆点状态设计

## 背景

当前 Agents 列表已经支持展示 `attention=requested` 的“需要确认”标记，但系统没有自动把正在等待用户下一步输入的 Codex Session 标记为 `requested`。因此在一个 Session 已经完成当前回答、实际上轮到用户 review 或继续提问时，左侧 Session card 仍只表现为普通 `running`，用户无法快速扫描出“哪个 Session 现在需要我处理”。

同时，当前 Session row 在标题下方直接展示 `Codex · running` 等文字状态。对高频扫描列表的场景，这种表达密度偏低，状态信号不够集中。

## 目标

本次设计要解决两个问题：

1. 让系统默认自动识别“Codex 当前已回答完、正在等待用户下一条输入”的运行中 Session，并将其标记为 `attention=requested`。
2. 将 Agents 列表中的 Session 状态视觉收敛为标题左侧圆点：
   - `running`：绿色圆点
   - `completed`（`closed` / `crashed` / `stopped` 所在 Completed 分组）：灰色圆点
   - `attention=requested`：黄色圆点，优先覆盖其他颜色

## 非目标

- 不新增新的 `AgentSessionStatus` 字面量。
- 不把“等待用户输入”升级为单独的 Session 分组。
- 不在前端本地维护业务真相，避免 UI 自己猜测 Session 是否已答完。
- 不同时重做 Issue card 的视觉状态表达；Issue 侧继续复用既有 `Codex 需要确认` 文案即可。
- 不在本次设计中引入 completion、git review、diff 预览或额外操作按钮。

## 术语与事实模型

### Session 主状态

保持现有约束：

- `running`
- `closed`
- `crashed`
- `stopped`

“等待用户输入”不是主状态，只是 `running` 期间的一个 attention 事实。

### Attention 状态

保持现有约束：

- `none`
- `requested`

本次只增加自动设置/清除 attention 的规则，不扩展新的 attention 字面量。

## 推荐方案

推荐采用“Rust Core 自动维护 attention，前端只消费事实”的方案。

### 原因

1. Session 与 Issue 都能共享同一事实源。
2. 页面刷新、重启后重新读取列表时，状态仍然稳定。
3. 后续 review、completion、手动清除 attention 等流程可直接复用同一数据链路。
4. 避免把“Codex 是否在等用户”这类业务判断散落到 React UI。

## 行为设计

### 自动设为 `requested`

当满足以下条件时，系统将运行中的 Session 设为 `attention=requested`：

1. Session 当前主状态仍为 `running`。
2. 最新终端输出已经进入 Codex 的“等待用户下一条输入”形态。
3. 当前 `attention` 不是 `requested`。

这里的“等待用户下一条输入”采用启发式检测，不尝试理解整段自然语言是否“看起来像答完了”，而是依赖终端尾部是否出现稳定的 Codex 输入就绪提示形态。

### 自动清回 `none`

当满足以下条件时，系统将该 Session 清回 `attention=none`：

1. 用户向当前 Session 成功写入了一次非空输入。
2. Session 当前主状态仍为 `running`。
3. 当前 `attention` 为 `requested`。

清除时机以“输入已经成功写入 PTY”为准，而不是“用户开始敲键盘”为准。

### 不自动提升的场景

- `closed` / `crashed` / `stopped` 不自动切换为黄色 attention。
- 仅有日志增长，但尾部未进入“等待输入”形态，不设为 `requested`。
- 空输入、无效输入或写入 PTY 失败，不清除 `requested`。

## 检测策略

### 首版策略

首版只做最小可验证启发式：

1. 读取 session log 的尾部窗口。
2. 对尾部文本做 ANSI/控制字符规整后匹配。
3. 识别 Codex 常见“输入已就绪”提示形态，例如新一轮提示符、输入光标所在行或固定提示片段。

### 设计取舍

- 不做完整 TUI 语义解析。
- 不依赖大模型判断“这段回复是否结束”。
- 允许首版 heuristics 偏保守，即宁可少亮一次黄点，也不要频繁误报。

### 后续可扩展性

若 Codex CLI 的提示形态后续变化，规则应集中在 Rust Core 的单独 helper 中维护，而不是散布在 command 或 UI 逻辑中。

## 系统边界与职责

### Rust Core

负责：

- 判断日志尾部是否进入“等待用户输入”形态
- 设置 `attention=requested`
- 在用户成功写入输入后清除 `attention`
- 对外通过现有 `list_agent_sessions` / `list_issues` 数据链路暴露 attention 事实

不负责：

- 渲染具体颜色或圆点样式
- 猜测用户是否已经看过这条回复

### React UI

负责：

- 在 Agents Activity 的 Session row 上根据状态和 attention 渲染圆点
- 继续在 Issue card 上展示既有 attention 文案
- 保留可访问性文本，避免只靠颜色表达

不负责：

- 从 terminal snapshot 本地推断 `attention`
- 维护 attention 状态机

## UI 设计

### Session row 结构

Session row 改为：

1. 标题首行左侧显示状态圆点。
2. 标题文字与圆点同一行对齐。
3. 次级信息保留为 `Codex` 等 agent 类型信息。
4. 去掉 `running` / `closed` / `stopped` 等文字状态显示。

### 圆点规则

- 默认 `running`：绿色圆点
- Completed 分组内的 `closed` / `crashed` / `stopped`：灰色圆点
- `attention=requested`：黄色圆点，优先覆盖上述颜色

### 可访问性

虽然视觉上不再显示文字状态，但 DOM 中仍需保留可访问性说明，例如：

- `Codex，运行中`
- `Codex，需要确认`
- `Codex，已结束`

保证用户不依赖颜色也能理解状态。

## 数据流

### 设为 `requested`

1. Session 持续运行并写日志。
2. Rust Core 在合适的 terminal/log 读取链路中检查日志尾部。
3. 若检测到“等待用户输入”形态，则更新该 Session 的 `attention=requested`。
4. 前端下次刷新 Session/Issue 列表时看到黄色状态。

### 清回 `none`

1. 用户在当前 Session 中发送新输入。
2. 输入成功写入 PTY。
3. Rust Core 更新该 Session 的 `attention=none`。
4. 前端下次刷新列表时恢复为绿色或灰色圆点。

## 错误处理

- 如果日志读取失败，不做 attention 自动切换，保持当前状态不变。
- 如果输入写入失败，不清除 `requested`，避免把“实际仍在等你处理”的状态误清掉。
- 如果 heuristics 无法识别当前尾部，保持 `attention=none`，不做激进猜测。

## 测试策略

### Rust

至少覆盖：

1. 检测到等待输入提示后，将 `running + none` 更新为 `running + requested`
2. 已是 `requested` 时重复检测，不重复制造无意义变更
3. 用户成功写入非空输入后，将 `requested` 清回 `none`
4. 空输入或写入失败时，不清除 `requested`
5. 非 `running` Session 不触发自动黄点

### TypeScript / React

至少覆盖：

1. `running + none` 渲染绿色圆点
2. `completed + none` 渲染灰色圆点
3. `attention=requested` 渲染黄色圆点并覆盖其他状态色
4. Session row 不再显示 `running` / `closed` 等文字状态
5. 可访问性标签仍能表述运行中、已结束、需要确认

## 验收标准

1. 一个 `running` 的 Codex Session 在当前回答结束、等待用户下一条输入时，左侧 Session card 自动出现黄色圆点。
2. 用户再次向该 Session 发送输入后，黄色圆点自动消失。
3. Session row 标题左侧始终显示一个状态圆点；列表中不再用文字展示 `running` 或 completed 类 Session 状态。
4. 已结束 Session 在 Completed 分组中显示灰色圆点；普通运行中 Session 显示绿色圆点。
5. attention 自动判断由 Rust Core 维护，前端不自行推断业务状态。

## 风险与回退

### 风险

- Codex CLI 终端提示形态可能变化，导致 heuristics 失准。
- 终端日志中可能包含 ANSI/TUI 控制字符，若规整不充分，会影响匹配稳定性。

### 回退策略

若自动检测误报过多，可临时退回“只保留手动或后续明确动作设置 attention”，但 Session row 圆点视觉仍可保留。

## 实施顺序建议

1. 先补 Rust attention 自动维护与测试。
2. 再改 Agents Session row 的圆点视觉与可访问性测试。
3. 最后跑前后端验证并确认没有破坏现有 `attention=requested` 展示链路。
