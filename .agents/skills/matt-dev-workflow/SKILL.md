---
name: matt-dev-workflow
description: 把常规开发任务串成一条「前半交互、后半无人」的闭环 —— /grill-with-docs 厘清需求后，用户一句 go 即自动出 spec、拆 tracer-bullet tickets、按 frontier 逐张 /implement（/tdd + /code-review + commit），最后汇总交用户验收。
disable-model-invocation: true
---

# Matt Dev Workflow

把 Matt Pocock 技能族的主流程（idea → ship）串成一条**前半交互、后半无人**的闭环：`/grill-with-docs` 厘清需求 → 用户一句 "go" → spec / tickets / 实现 / 提交全部自动完成 → 汇总交用户做最终验收。

适用**常规、单会话级**开发任务。超大雾化任务用 `/wayfinder`；只澄清无代码计划用 `/grill-me`。

## 前置

- 假设 `/setup-matt-pocock-skills` 已跑过（仓库存在 `docs/agents/issue-tracker.md` 或 `## Agent skills` 块）。没有 → **停下**，让用户先跑它，不自行补。
- tracker 形态（本地 `.scratch/` / GitHub / …）以 `docs/agents/issue-tracker.md` 为准，照其约定落盘。

## 阶段 0 — 交互式厘清（grill-with-docs）

运行 `/grill-with-docs`，完整跑完 `grilling` + `domain-modeling`：

- 一次一问、每问给推荐答案；代码能查的事实自己查，决策才问用户。
- 边问边把术语写进 `CONTEXT.md`、把难逆决策写成 ADR。
- **不实施**，直到用户确认「已达成共识」。

这是本流程**唯一的交互阶段**。grilling 中若冒出「需要跑一下才能回答」的问题（状态 / 逻辑 / UI 必须看），停下，建议 `/handoff` 出去 + `/prototype` 再 `/handoff` 回 —— 这是对无人化的合理打断，交用户决定。

**完成判定**：用户明确确认共识并给出 "开始 / go"。否则停在 grill。

## 切入无人阶段（go 之后）

用户一句 "go" 即把控制权交给自动阶段。**此后不再向用户提问**，除非命中「停止条件」。

进入前做两件一次性准备：

1. **落共识锚点**：把 grill 结论压成一句话目标 + 关键决策清单，作为 spec / tickets / 子代理的共同起点（spec 路径是它们的实际锚点）。
2. **定分支**：
   - 当前已在 **worktree 分支**（`git worktree list` 中 cwd 命中某 linked worktree 路径，即会话已处于独立分支）→ 就地提交，不开新分支。
   - 否则（在主仓库默认分支上）→ 先创建一个 feature 分支再开始，整条流程都在此分支提交。
   - 未经用户要求不 push / merge / rebase / tag / 改写历史。

## 阶段 1 — 自动出 spec（to-spec，非交互）

运行 `/to-spec` 的流程，但**覆盖其 "check seams with user"**：不停下问用户，按其规则自动决策 ——

- 选**最高**既有 seam，能用一个就不开新 seam；确需新 seam 时在最高点提议。
- 把所选 seam、理由、以及「若用户复核后想改可改」的假设写进 spec 的 Testing Decisions。

其余步骤（探索代码、用 glossary 词汇、遵守相关 ADR、套 spec 模板、发布、打 `ready-for-agent`）原样执行。

**完成判定**：`.scratch/<slug>/spec.md` 已落盘、含 seam 决策、已打 `ready-for-agent`。

## 阶段 2 — 自动拆 tickets（to-tickets，非交互）

运行 `/to-tickets` 的流程，但**覆盖其 "quiz the user"**：不停下问用户，按 tracer-bullet 规则自动决策 ——

- 每张是纵向完整切片（schema / API / UI / tests 全打通）、可独立验收、单上下文可装下。
- 先做 prefactoring 再切片；宽重构走 expand–contract。
- 自动给阻塞边，得出 frontier 顺序（blockers 全 done 的票优先；线性链即从 `01` 起）。
- 把粒度理由 + 假设写进各 ticket / 汇总。

其余步骤（glossary 词汇、遵守 ADR、一票一文件、`ready-for-agent`）原样执行。不关不改任何父 issue。

**完成判定**：`.scratch/<slug>/issues/NN-*.md` 全部落盘、阻塞边齐全、frontier 顺序已定。

## 阶段 3 — 按 frontier 逐张 /implement（硬性，禁止主会话降级）

> **核心约束**：阶段 3 的实现工作 = 对每张 frontier ticket **完整运行 `/implement` skill**。
> 主会话（orchestrator）**不得**以「赶进度 / 工具慢 / 子代理半成品」为由，在主上下文里直接改业务代码并 commit 冒充 implement。

### 3.1 每张票的强制形态

frontier 上**每一张** ticket：

1. **派一个全新子代理**（独立上下文；`fork_context: false`）。一票一代理，禁止复用上一票代理「接着改」。
2. 子代理启动提示必须显式包含：
   - 默认简体中文；不要输出思考过程
   - 你不是一个人在改代码，不要回退他人改动
   - **必须按 `/implement` 执行**，不是「随便改到绿」
   - spec 路径、本 ticket 路径、分支名、seam（从 spec Testing Decisions 抄）
   - 完成清单（见 3.2）
3. 子代理内按 `/implement` 原样走完：
   - 在 spec 约定 seam 上 `/tdd`（红 → 绿；一片一片）
   - 定期类型检查 / 聚焦单测
   - **本票收尾跑全量测试**（前端 `pnpm test` 若本票动了 TS；Rust `cargo test` 若本票动了 Rust；两者都动则都跑。纯 docs 票除外）
   - **跑 `/code-review`**（Standards + Spec 两轴，固定点 = 本票开始前的 HEAD）
   - review 有必须修的问题 → 在本票内修到过，再 commit
   - 在阶段 0 所定分支上 **commit**（标题遵守仓库 git 规范）
4. 子代理回报必须含：交付、测试命令与结果、**review 两轴结论**、commit hash、改动文件。缺任一项 = 未完成。
5. 主会话核验回报与 `git log` / 测试输出后，才把 ticket 标 `done`，再启动下一张。

一张未 green，**禁止**启动下一张。

### 3.2 单票 green 定义（缺一不可）

- [ ] 验收标准全部满足
- [ ] `/tdd` 在约定 seam 上执行（非「先写光实现再补测」）
- [ ] 本票要求的全量测试通过
- [ ] `/code-review` Standards + Spec **均通过**（或仅剩已记录的非阻断 nit，且不违反 AGENTS 门禁）
- [ ] 已 commit，工作区无本票残留改动
- [ ] 子代理回报完整

任一项缺失 → 该票 **not green**，不得进入下一张，也不得进入最终验收「全部完成」口径。

### 3.3 主会话允许做什么 / 禁止做什么

**允许（编排）**

- 写 spec / tickets、定分支、更新 ticket Status 注释
- spawn / wait / 核验子代理结果
- 跑只读核验命令（`git status`、`git log`、复跑测试确认子代理声称）
- 按停止条件汇总交用户

**禁止（除非走 3.4 恢复协议）**

- 主会话直接实现 ticket 业务代码
- 跳过 `/tdd`、`/code-review`、全量测试
- 子代理未 commit 时主会话代 commit 半成品并标 done
- 「先全部实现，最后统一 review / 测试」
- 因 wait 超时、shell 默认超时、子代理慢，就改在主会话手写

### 3.4 子代理失败时的恢复协议（唯一合法降级）

仅当子代理 **明确失败 / 超时 / 半成品残留** 时，主会话按序处理，**禁止静默接手写完**：

1. **记录失败**：ticket `## Comments` 写明失败形态（超时 / 测试红 / review 不过 / 半成品路径）。
2. **清理或保全**：若工作区有半成品，要么 `git stash` / 丢弃到可复现状态，要么在评论中列出未提交文件；不得无说明混进下一尝试。
3. **重派一次**全新子代理，提示中附上失败原因与半成品状态，仍要求完整 `/implement`。
4. **第二次仍失败** → **停止整个自动阶段**，上浮该票 + 两次失败原因 + 已 green 前序结果，交用户裁决。
5. **禁止**主会话在第二次失败后自行写完并宣称流程成功。

唯一例外：用户在停止后明确说「主会话接手实现这张票」——那是用户指令，不再算本 skill 的无人阶段。

### 3.5 工具摩擦不算豁免

下列情况 **不是** 跳过 `/implement` 的理由：

- `wait_agent` / 长测命令超时 → 换后台跑 + 轮询，或拉长等待；仍失败走 3.4
- 子代理只交了部分文件 → 重派或停止，不主会话补完冒充 green
- 「相关测试已绿」→ 不能代替本票全量测试与 code-review

### 3.6 全流程结束后的总 gate（主会话）

所有 ticket green 后，主会话再跑一次：

- 仓库 AGENTS 门禁要求的验证（本任务改动语言对应项）
- `git status --short` 无任务残留
- 最终验收汇总（见下）

若发现某票其实缺 review / 缺全量测，**回溯该票**为 not green，走 3.4 或交用户，不得在汇总里写成全部完成。

**阶段 3 完成判定**：frontier 每张票均满足 3.2；总 gate 通过。

## 停止条件（命中即停下交用户，绝不强行推进）

- grill 决策需 runnable 答案 → 已在阶段 0 处理。
- 前置 setup 未就绪 → 停，让用户先跑 setup。
- grill → tickets 阶段逼近 smart zone（~120k）→ `/handoff`，在 fresh session 续跑，不降级硬撑。
- 某张 ticket：测试红且子代理无法在范围内修好，或 `/code-review` 不过且无法自决修复 → **停整个自动阶段**，上浮该票 + 失败原因 + 已 commit 的前序结果。
- 3.4 恢复协议第二次仍失败 → 同上停止。
- 不跳过、不强提交坏代码、不留 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 跳过测试。
- **不**把主会话手写实现当成自动阶段成功。

## 最终验收（汇总交用户）

自动阶段结束（全部 green，或被停止条件打断）后，一次性汇总：

- spec 路径、tickets 清单 + 各自状态（含是否完整 `/implement`：tdd / 全量测 / code-review / commit）
- 每张票：交付、测试、**review 结论**、commit、改动文件
- 整体 diff（`git diff <base>..HEAD`）与文件列表
- 若中途停下：卡点、原因、建议下一步

验收（合并 / 继续 / 返工）由用户决定；不替用户 merge / push。
