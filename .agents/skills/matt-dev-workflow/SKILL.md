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
- **控粒度防子代理超时**：单票应能在约一次「过滤测试 + 有界全量」内收尾；若预估需长时间全仓慢测、多模块深改或 >1 次完整 /code-review 才能装下，继续拆票，不要把「整条重构主干」塞进一张。

其余步骤（glossary 词汇、遵守 ADR、一票一文件、`ready-for-agent`）原样执行。不关不改任何父 issue。

**完成判定**：`.scratch/<slug>/issues/NN-*.md` 全部落盘、阻塞边齐全、frontier 顺序已定。

## 阶段 3 — 按 frontier 逐张实现（implement，每票一新子代理）

frontier 上每张 ticket，**派一个全新子代理**（独立上下文，互不污染）实现。主代理只编排与验收回报，**禁止因 wait 超时就接管实现**（见「主代理纪律」）。

### 3.1 子代理必须完成的工作

- 读 `spec.md` + 本 ticket 文件出发。
- 按 spec 指定的 seam 走 `/tdd`（红-绿-重构，一片一片来；**禁止**先写光实现再补测冒充 TDD）。
- 验证按 **§3.3 验证阶梯**，不得一上来无过滤全量慢测。
- 跑 `/code-review`（Standards + Spec 两轴）。
- 在阶段 0 定的分支上 commit（信息遵循仓库 git 规范；来自 GitHub issue 则 `Refs: #…`）。
- 最终回报：交付了什么、测试状态（含跑过的过滤命令）、review 结论、commit hash、改动文件、遗留。

一张 green 后再起下一张；阻塞边未满足的票不启动。ticket 之间天然清上下文（一票一子代理即此意）。

**完成判定**：frontier 上每张票都回报 green（测试通过 + review 通过 + 已 commit）。

### 3.2 派工 prompt 必含项（缺一不可）

每张票的 spawn 消息必须显式包含：

1. **范围**：要改的模块 / 边界；**明确不做**清单。
2. **锚点路径**：`spec.md`、本 ticket、相关 ADR。
3. **分支与提交**：当前分支名；就地 commit；提交标题风格；`Refs`（若有）。
4. **TDD**：先失败测试再实现；最终回报需能对应红→绿证据（至少写清测了哪条行为）。
5. **验证阶梯**（复制 §3.3 命令策略，按本票替换过滤关键字）。
6. **分段回报节点**（到点必须写一行进度，禁止长时间静默）：
   - 红测已写
   - 实现已绿（附过滤测试摘要）
   - code-review 结论
   - commit hash
7. **卡住协议**：同一阻塞超过约 10 分钟 → 先回报阻塞点与已尝试手段，不要静默空转。
8. **语言**：默认简体中文；不要输出思考过程。
9. **协作**：不是一个人在改仓库；不要回退他人改动；只改本票相关文件。

### 3.3 验证阶梯（防全量慢测拖死子代理）

子代理**必须**按序执行；主代理验收时核对是否跳级：

1. **聚焦**：只跑本票相关过滤测试（如 `cargo test --lib <keyword>` / `pnpm test` 带 vitest 过滤）。优先快、可定位。
2. **本票相关类型 / lint**（若仓库门禁要求且本票触及该语言）：按 `AGENTS.md` 执行，但勿把无关包全量拖进来。
3. **有界加宽**（可选）：聚焦绿后再跑「与改动同 crate / 同 package」的测试；仍避免已知超慢套件，除非本票直接改了它们。
4. **全量**：仅当 ticket / `AGENTS.md` **明确要求**本票必须全量时才跑；跑之前在进度里声明「开始全量」。若仓库存在已知超慢用例（例如长时间 PTY/终端集成测），允许在回报中写明「未跑哪些、为什么、风险」，**不得**为了全量卡死而既不回报也不提交。

前端门禁（`pnpm format` / lint / typecheck / test）以 `AGENTS.md` 为准：纯 Rust/docs 票可豁免 pnpm，但须在最终回报写明豁免理由。

### 3.4 主代理纪律（超时 ≠ 接手）

- **wait 要给足时间**：实现票默认按 **数分钟级** 等待（编译 + 过滤测试常见 2–10 分钟；若子代理已声明进入全量，可更长）。短超时轮询不得判「失败」。
- **超时后先观测再动作**，顺序固定：
  1. 看是否仍有 `cargo` / `pnpm` / 编译进程，或 `git status` 是否持续有本票 diff；
  2. 若仍在工作 → **继续 wait**，不要 interrupt；
  3. 若长时间无进展 → `send_input` **只催进度/提交**（勿改需求、勿塞新实现指令）；
  4. 仅当子代理明确失败且无法自修，或命中「停止条件」→ **停整个自动阶段交用户**。
- **禁止**：因 wait 超时就由主代理重写实现、代补整票逻辑、或 interrupt 掉正在跑的长测。
- **允许的主代理最小动作**（仍算编排，不算接手实现）：
  - 提醒子代理按 §3.3 跑过滤测试并 commit；
  - 子代理已实现且自报绿、仅 commit 失败时，可代为按规范 commit（diff 必须仍是子代理产出）；
  - 关闭已确认死亡/空转的子代理后，**再派一个新子代理**续同一张票（把已改文件与未完成 acceptance 写入 prompt），而不是主代理自己写完。
- **interrupt 限制**：默认不用。仅用于子代理明显跑飞（改错范围、死循环命令）且已用普通 `send_input` 无效时。

### 3.5 主代理对子代理回报的验收

每张票在启动下一张前，主代理核对：

- ticket acceptance 可勾选完成；
- 存在对应 commit（`git log`），工作区无本票残留；
- 回报中的测试命令与 §3.3 一致（有过滤，或合理解释了全量/豁免）；
- 未引入 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 跳过测试。

任一失败 → 先让**同一职责的新子代理**修补该票；仍失败 → 停止条件上浮用户。

## 停止条件（命中即停下交用户，绝不强行推进）

- grill 决策需 runnable 答案 → 已在阶段 0 处理。
- 前置 setup 未就绪 → 停，让用户先跑 setup。
- grill → tickets 阶段逼近 smart zone（~120k）→ `/handoff`，在 fresh session 续跑，不降级硬撑。
- 某张 ticket：测试红且子代理无法在范围内修好，或 `/code-review` Standards / Spec 不过且子代理无法自决修复 → **停整个自动阶段**，上浮该票 + 失败原因 + 已 commit 的前序结果，交用户裁决。不跳过、不强提交坏代码、不留 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 跳过测试。
- 同一张票连续 **两个** 新子代理均无法在范围内 green → 停，交用户（避免无限换代理空转）。
- 主代理不得用「自己实现完」绕过停止条件。

## 最终验收（汇总交用户）

自动阶段结束（全部 green，或被停止条件打断）后，一次性汇总交用户做最终验收：

- spec 路径、tickets 清单 + 各自状态。
- 每张票：交付内容、测试 / review 结论、commit、改动文件。
- 整体 diff（`git diff <base>..HEAD`）与改动文件列表。
- 若中途停下：说明卡在哪、为何、建议下一步。

验收（合并 / 继续 / 返工）由用户决定；本流程不替用户做合并或推送。
