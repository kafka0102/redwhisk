# 输入对账：RedWhisk MVP PRD

## 对账结论

已完成对 `_bmad-output/planning-artifacts/prds/prd-redwhisk-2026-06-03/prd.md` 与 `addendum.md` 的 UX 输入对账。`DESIGN.md` 承接用户确认的视觉方向：light 模式参考 Multica 的白底黑字灰辅助，dark 模式参考 VS Code / Trae 的纯黑开发工作台，整体简洁清新、有桌面软件质感，避免管理 SaaS 和廉价网页应用。`EXPERIENCE.md` 承接 PRD 的 MVP scope freeze、IA、状态模型、Dialog / Inspector / Header 行为和信任规则。

## 覆盖情况

| PRD / 用户输入 | UX 处理 |
| --- | --- |
| 跨平台桌面 Agent 开发工作台 | `EXPERIENCE.md` Foundation、Responsive & Platform |
| 不做管理 SaaS / 不像廉价网页应用 | `DESIGN.md` Brand & Style、Do's and Don'ts；`EXPERIENCE.md` Inspiration & Anti-patterns |
| Light 参考 Multica | `DESIGN.md` colors、Colors；`EXPERIENCE.md` Inspiration |
| Dark 参考 VS Code / Trae | `DESIGN.md` colors、Colors；`EXPERIENCE.md` Inspiration |
| Activity Bar：Issues / Agents / Settings | `EXPERIENCE.md` Information Architecture、Component Patterns |
| Issues 四泳道 | `EXPERIENCE.md` Information Architecture、Component Patterns、State Patterns |
| Issue Detail Dialog 左右两栏 | `EXPERIENCE.md` Component Patterns |
| Run Dialog 轻量，不展示 command 可用性和配置来源 | `EXPERIENCE.md` Component Patterns、State Patterns |
| Agents 左右两栏 | `EXPERIENCE.md` Information Architecture、Component Patterns |
| Session Dialog 极简 | `EXPERIENCE.md` Component Patterns、Key Flow 3 |
| Session Header 与 Issue Inspector | `EXPERIENCE.md` Component Patterns、Key Flows |
| Review 继续修正 | `EXPERIENCE.md` State Patterns、Key Flow 2 |
| Completion Policy 与 Agent Commit 信任 | `EXPERIENCE.md` Component Patterns、Product-Specific Trust Rules |
| Completed Summary / Open Log | `EXPERIENCE.md` State Patterns、Key Flow 4 |
| UI 支持 zh-CN / en-US | `EXPERIENCE.md` Accessibility Floor |

## 有意不覆盖为视觉 mock 的内容

- 本次采用 Fast path，未生成 `.working/key-*.html` mockups。
- `.working/` 与 `imports/` 保持为空；DESIGN / EXPERIENCE spine 是当前 UX 合同。
- 如后续需要视觉校准，建议补四个 key-screen mockups：`Issues Activity`、`Agents Activity with linked Issue`、`Run Dialog`、`Completion Confirmation`。

## 仍需后续确认

1. Command Palette 是否进入 MVP。
2. 快捷键是否与平台或 Codex TUI 冲突。
3. `< 960px` 窗口下 Sidebar 行为与 MVP 最小可用宽度。
4. `stopped` 是否作为正式 Agent Session 状态。
5. 是否需要 key-screen mockups 作为实现前视觉参考。
