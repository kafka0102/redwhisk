# 任务 3：GitLab Issue 与同步生命周期收口

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 依赖 | 任务 1、任务 2 已完成 |
| 直接后续 | 任务 4、任务 6 |
| 最近更新 | 2026-11-06 |
| 总计划 | [README](./README.md) |

## 目标

在现有 GitHub 镜像和自动同步框架上增加 GitLab Issue 支持，消除 provider 硬编码，补齐自建 GitLab host 和跨宿主一致性，并完成来源模式切换确认。完成后，GitHub 与 GitLab 项目使用同一套看板、筛选、同步状态和缓存语义。

## 当前基线

- GitHub Issue 镜像、来源筛选、自动同步、失败退避和运行锁已经完成。
- `issue_external_refs` 已有 `provider` 字段，但同步写入仍硬编码为 `github`。
- `sync_project_issues` 遇到 GitLab 连接时直接返回 `CacheFailed`，尚未实现 `glab` Issue 适配器。
- 当前页面可见、窗口聚焦、自动同步开关和 90 秒间隔的调度框架可复用。
- 同步错误文案仍使用 GitHub 专用 key。
- 设置页已有 GitLab 连接探测与 Merge Request 相关文案，但 `s6` 模式切换确认框未实现。

先核对：

- `src-tauri/src/features/issue/github_issue_mirror/sync.rs`
- `src-tauri/src/features/issue/github_issue_mirror/port.rs`
- `src-tauri/src/features/issue/github_issue_mirror/cli.rs`
- `src-tauri/src/features/issue/github_issue_mirror/board.rs`
- `src-tauri/src/features/issue/commands.rs`
- `src/features/issues/use-issue-sync-chrome.tsx`
- `src/features/issues/use-issue-auto-sync.ts`
- `src/features/issues/issue-sync-toolbar.tsx`
- `src/features/settings/settings-issues-panel.tsx`
- `src/features/settings/settings-issues-mode-card.tsx`

## 本任务范围

### GitLab Issue 只读镜像

- 新增 GitLab CLI 适配，使用现有 `ForgeIssuePort` 语义读取 Issue 列表。
- 支持 gitlab.com 与自建 GitLab host，不在业务逻辑里写死 `gitlab.com`。
- GitLab Issue 映射到与 GitHub 相同的本地镜像字段：外部身份、项目内远端编号、标题、正文、open/closed、作者、指派、标签、URL、更新时间。
- 标签、指派、作者字段缺失时允许降级，不因单个可选字段缺失导致整批同步失败。
- GitLab 与 GitHub 的项目内唯一约束必须使用同一语义：`(provider, host, external_id)` 与 `(project_id, provider, host, repo, external_number)`。
- 固定 fixture 覆盖 GitLab JSON 形状和不可解析输出。

### Provider 泛化

- 同步服务根据连接 provider 选择适配器，不新增第二套同步调度、退避或看板投影。
- 写入 `issue_external_refs.provider` 时使用真实 provider，不再硬编码 `github`。
- 看板投影、错误状态、来源徽标和来源筛选保持 provider 无关。
- 删除用户可见的 GitHub 专用同步错误命名，改为宿主无关键；GitHub/GitLab 都可表达凭据过期、离线、限流和缓存失败。
- CLI 命令显式使用项目仓库目录，并走现有交互式 `PATH` 解析。token 不进入参数、SQLite 或日志。

### 同步生命周期收口

- 保留现有页面可见、窗口聚焦、自动同步开关、默认 90 秒、失败退避和单项目运行锁。
- 验证 GitHub 与 GitLab 都遵守“失败不清空已有镜像”。
- 首次同步、增量同步、手动刷新和自动刷新不能并发写同一项目。
- GitLab 凭据过期、CLI 缺失、网络失败时仍可浏览已有缓存，并显示可恢复状态。
- 增加同步相关回归测试，防止 GitLab 接入破坏 GitHub。

### 来源模式切换确认

- 保存前如果来源模式发生变化，显示确认框。
- 确认框使用原型 `s6` 的信息结构：本地 Issue 数量与“隐藏但保留”、远程 Issue 数量与“切换后显示”、同步是否访问远程。
- 用户取消时不保存任何来源设置变化。
- 用户确认后才持久化新模式；仍不得删除任何本地业务数据。
- 模式未变化时不弹确认框。
- 数量来自现有本地缓存查询，不为了弹框触发整库扫描或远程网络请求。

## 非目标

- 不在本任务实现远程 Issue 评论和系统事件时间轴。
- 不在本任务实现远程 Issue 创建、关闭、评论写回。
- 不在本任务建立 PR/MR 一等实体或 PR 列表。
- 不因 GitLab 接入改造已有 Issue 详情布局。
- 不引入 HTTP/OAuth/token 存储。

## 原型页面

主原型：[issue-pr-workbench.prototype.html](../../../../src/features/issues/issue-pr-workbench.prototype.html)

| 场景 | 标题 | 本任务必须核对 |
| --- | --- | --- |
| `s1` | 混合模式看板 | GitHub/GitLab 来源徽标、筛选选项、同步栏和错误背景使用同一布局 |
| `s2` | 仅远程 · 凭据失效 | GitLab 类比状态也保留缓存；不因 provider 改变布局 |
| `s13` | 仅本地模式 | 不显示来源筛选和同步控件 |
| `s5` | 项目设置 · Issues | provider 连接、范围、同步与写回文案 |
| `s6` | 切换来源模式 | 确认框、计数、取消、确认、非破坏性说明 |
| `s16` | GitLab 项目设置 | `glab` 连接、Merge Request 文案、自建 host 展示 |

截图建议：`task-03-s06-mode-switch.png`、`task-03-s16-gitlab-settings.png`、`task-03-s01-mixed-board.png`。截取完整应用外壳，不要只截下拉框。

## 契约要求

- 需要改动 Tauri 命令返回字段时，同步更新 Rust DTO、TypeScript 类型、`docs/architecture-design/tauri-contract.md` 和 DTO parity 快照。
- 新增错误码或错误 reason 时，按现有分类同步文档和 i18n。
- 来源筛选继续使用宿主无关值 `all / local / remote`；具体 provider 由返回数据决定。
- 不新增无必要的公开 command；优先泛化现有同步 command。

## 验收标准

- GitHub 项目回归行为不变，GitLab 项目能同步 Issue 到同一看板。
- GitLab 自建实例能保存并识别正确 host。
- 重复同步 GitLab Issue 不产生重复数据。
- GitHub 与 GitLab Issue 可同时出现在同一混合看板并用远程筛选显示。
- GitLab 凭据过期、CLI 缺失或网络失败时缓存不清空。
- 自动同步不会与手动刷新并发执行。
- 模式切换确认框按 `s6` 工作；取消不保存，确认不删数据。
- 所有同步文案为宿主无关键，中英文完整。

## 必测覆盖

- GitLab CLI JSON fixture：正常、字段缺失降级、非法输出。
- GitLab host/repo 解析：gitlab.com、自建域名、非 forge remote。
- provider 写入与唯一键幂等。
- GitHub/GitLab 共用同步、来源筛选和错误缓存路径。
- 自动同步与手动刷新互斥。
- 模式切换确认：未变化不弹、取消不保存、确认保存且历史数据不变。
- 前端看板与设置页对 GitLab 文案和状态渲染。

## 完成记录

实现完成后追加；不得覆盖本节已有内容。

```text
日期：
状态：
提交：
实际改动：
验证命令与结果：
原型场景对照：
与原计划的差异：
对后续任务的影响：
未完成项及承接任务：
```

### 2026-11-06

日期：2026-11-06

状态：已完成

提交：

- GitLab Issue 同步：`d509a051d4045ed2f1df6567f1486ab25926fb3a`
- 来源模式确认、计数字段和这份计划更新在同一次后续提交，提交前工作区尚未形成该 hash

实际改动：

- GitLab 列表走现有同步；`glab issue list --output json`；失败保留缓存；看板 GL 徽标；确认框六种方向都弹，确认才保存模式，不删 Issue

验证命令与结果：

- 前端全量 2172 通过；Rust `check-rust-compile.sh`、文件大小、用户字符串通过

原型场景对照：

- s1/s2/s13 看板显隐，s6 确认框，s16 完成后仍是 Merge Request

与原计划的差异：

- 本机 glab 1.124 的 JSON 是 `--output json`，不用设计稿里的 `-F json`

对后续任务的影响：

- 任务 4、6 的阻塞已解除，但它们本身仍未完成

未完成项及承接任务：

- 无本任务遗留。任务 4、任务 6 仍未完成。

## 计划校准

本任务已根据当前实现调整：原任务 3 的通用自动同步、退避、运行锁和缓存保留已在任务 2 完成，不再重复。任务 1 遗留的模式切换确认并入本任务。

执行中若发现 GitLab CLI 能力与设计假设不一致：

1. 以 fixture 和实际 CLI 输出为准，记录差异。
2. 不阻塞 Issue 列表这个核心闭环；可选字段降级。
3. 若缺少完成本任务验收所必需的能力，记录外部阻塞及恢复条件。
4. 更新本任务、总计划和任务 4/6 的当前基线。

## 完成时要更新的文档

- 本文件：状态、完成记录、实际差异、对任务 4/6 的接口说明。
- 总计划：任务 3 状态、任务 4/6 是否解除依赖、变更历史。
- 若改变 DTO/命令/事件：Tauri contract 与 data model。
- 若改变来源模式确认语义：更新产品设计对应章节。
