# 输入对账：brainstorming-session-2026-06-02-222104.md

## 对账结论

已完成对 `_bmad-output/brainstorming/brainstorming-session-2026-06-02-222104.md` 的输入对账。`prd.md` 覆盖了已确认的 MVP scope freeze、状态模型、用户故事、React IA、Settings 分层、Run Dialog / Session Dialog、Completion Policy、Spike 和风险口径；`addendum.md` 承接了技术模块、数据模型、Command/Event、里程碑和信任清单。

## 覆盖情况

| 输入区域 | PRD 处理 |
| --- | --- |
| 产品定位：VS Code 形态 Agent 工作台 | `prd.md` §1、§4 |
| MVP 最短闭环 | `prd.md` §1、§2.3、§5、§8 |
| Workspace 必须绑定 Git 仓库 | `prd.md` FR-1、FR-2 |
| 极简 Issue | `prd.md` FR-4、FR-5、非目标 |
| Agent Profile、Workspace override、command 检测 | `prd.md` FR-7、FR-8、FR-9 |
| Run Dialog 轻量化，不展示 command 可用性和配置来源 | `prd.md` FR-8、FR-9、FR-10 |
| 内嵌 Codex Native Session View | `prd.md` FR-13、FR-14；`addendum.md` Spike 1 |
| attention 模型 | `prd.md` FR-15 |
| 一 Issue 一 Agent Session | `prd.md` FR-12 |
| review 继续修正，不退回 running | `prd.md` FR-17、FR-18 |
| Completion Policy 与 CompletionAttempt | `prd.md` FR-20、FR-21、FR-22 |
| completed Summary / Open Log | `prd.md` FR-23、FR-24 |
| Activity Bar 只保留 Issues / Agents / Settings | `prd.md` §4；`addendum.md` §7 |
| Issues Activity 四泳道 | `prd.md` §4、FR-5；`addendum.md` §7 |
| Issue 详情左右两栏 | `prd.md` FR-5；`addendum.md` §7 |
| Agents Activity 左右两栏，Session 与 Review 无关 | `prd.md` §4、FR-13；`addendum.md` §7 |
| Workspace Settings / Global Settings 分层 | `prd.md` FR-3 |
| 不关联 Issue 的临时 Session | `prd.md` UJ-5、FR-16 |
| Session Dialog 极简字段 | `prd.md` FR-16 |
| Running / Completed Session 排序和最近 20 条规则 | `prd.md` FR-13 |
| Session Header 与 Issue Inspector | `prd.md` FR-25 |
| Spike 与开发路线 | `addendum.md` §9、§10 |
| 用户信任风险 | `prd.md` NFR、Success Metrics；`addendum.md` §11 |

## 已修正的输入冲突

- 输入文档早期 IA 提到 Agent 页面三栏布局、Issue Panel 和 Diff Panel；后续 Confirmed IA #45、#48、#53 覆盖为左右两栏、Session Header 和 Issue Inspector。PRD 采用后续确认口径。
- 输入文档早期提到 Run Dialog 展示配置来源；后续 Confirmed IA #47 明确 Run Dialog 不展示 command 可用性和继承/覆盖来源。PRD 采用后续确认口径。
- 输入文档早期 Session 主状态曾出现 `completed` 口径；后续 State #29 以及 IA #45 使用 Session 展示分组而非业务 review 分组。PRD 采用 `running`、`closed`、`crashed`、可选 `stopped` 的 Agent Session 状态，并用 `Running` / `Completed` 作为展示分组。

## 仍需后续确认

这些问题不阻塞当前 PRD 进入 UX / 架构 / 故事拆分，但需要在对应阶段复核：

1. 产品正式名称是否确认使用 RedWhisk。
2. 新 Workspace 默认 Completion Policy 是否固定为 `manual`。
3. `attention=requested` 的启发式识别可靠性目标。
4. Windows / Linux 兼容性进入哪个里程碑。
5. completion prompt 的具体模板和失败兜底文案。
6. `stopped` 是否作为正式 Agent Session 状态保留。
