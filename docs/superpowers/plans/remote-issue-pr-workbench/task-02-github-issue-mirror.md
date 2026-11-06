# 任务 2：GitHub Issue 只读镜像与混合看板

## 元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | 已完成 |
| 依赖 | 任务 1 |
| 直接后续 | 任务 3 |
| 最近更新 | 2026-11-06 |
| 总计划 | [README](./README.md) |

## 目标

把 GitHub Issue 只读镜像到现有 SQLite Issue 工作流中，在混合模式看板中与本地 Issue 共存，并提供来源筛选、同步状态、错误缓存和可见页面自动同步。

## 当前基线

- 迁移 `0061_issue_external_refs.sql` 已保存远程身份、仓库、编号、URL、远端状态、作者、指派、标签和同步事实。
- `ForgeIssuePort` 与 `GithubCliForge` 已实现 Issue 列表读取和 JSON fixture 解析。
- GitHub 列表中的 Pull Request 会被过滤。
- 远程 Issue 写入现有 `issues` 表，`source=remote`，本地工作流状态与远端状态分开。
- 重复同步按 `(provider, host, external_id)` 或项目内远端编号幂等更新。
- 远端关闭/重开按状态规则调整本地工作流状态；执行中的 Issue 不因远端关闭自动终止。
- 混合模式支持“全部 / 仅本地 / 远程”筛选，远程卡片显示来源徽标、标签、同步状态和错误态。
- 自动同步只在页面可见、窗口聚焦且配置开启时运行，失败指数退避到最多 900 秒。
- 自动与手动同步有运行锁，失败保留缓存。
- Tauri 同步事件触发看板和同步状态刷新。

主要实现：

- `src-tauri/migrations/0061_issue_external_refs.sql`
- `src-tauri/src/features/issue/github_issue_mirror/`
- `src-tauri/src/db/issue_external_ref_repository.rs`
- `src/features/issues/use-issue-sync-chrome.tsx`
- `src/features/issues/use-issue-auto-sync.ts`
- `src/features/issues/issue-source-filter.tsx`
- `src/features/issues/issues-kanban.tsx`
- `src/features/issues/issue-sync-toolbar.tsx`

## 原型对照

| 场景 | 标题 | 本任务核对内容 |
| --- | --- | --- |
| `s1` | 混合模式看板 | Tab 行位置、来源筛选、同步状态、来源徽标、卡片正常与错误态 |
| `s2` | 仅远程 · 凭据失效 | 缓存仍可见、错误提示、刷新图标、远程模式隐藏来源筛选 |
| `s13` | 仅本地模式 | 不访问远程、不显示来源筛选和同步控件 |

## 完成记录

### 2026-11-06 回填

日期：2026-11-05

状态：已完成

提交：

- `41266a71 feat: 将 GitHub Issue 只读镜像同步到看板`
- `4baae8e7 feat: 按来源筛选 GitHub Issue 并自动同步`

实际改动：

- 增加远程引用表、repository、GitHub CLI 适配、同步和看板投影。
- 增加来源筛选、远程徽标、标签、同步工具栏和自动同步。
- 增加远端关闭/重开与运行中 Issue 的状态联动规则。
- 增加 fixture、幂等、错误缓存、来源筛选和自动同步测试。

验证证据：

- GitHub JSON fixture 覆盖列表解析和 PR 过滤。
- repository/behavior 测试覆盖 upsert、来源过滤、状态规则和错误缓存。
- 前端测试覆盖来源筛选、同步控件、自动同步、可见性和运行锁。

原型场景对照：

- `s1` 已实现。
- `s2` 的缓存与错误体验已实现，错误文案仍需从 GitHub 专用改为宿主无关。
- `s13` 已实现。

与原计划的差异：

- 原任务 3 的自动同步、90 秒默认间隔、失败退避和同步运行锁已在本任务完成。
- 当前同步和错误文案仍有 GitHub 专用命名，例如 `issues.githubCredentialExpired`。
- Pull requests Tab 仍是固定空态和零计数，属于任务 6，不是本任务缺陷。

对后续任务的影响：

- 任务 3 不再实现通用自动同步框架，只补 GitLab、跨宿主一致性和模式切换收口。
- 任务 3 应把 GitHub 专用同步错误文案改为宿主无关，并复用现有退避、可见性和运行锁。
- 任务 4 可以读取 `issue_external_refs` 的远程基础字段，但评论与系统事件仍需实现。

未完成项及承接任务：

- GitLab 同步与宿主无关文案 → 任务 3。
- 远程评论、系统事件和 Issue 详情宿主卡片 → 任务 4。

## 计划校准

保持任务 2 为已完成。原任务 3 的生命周期能力已经存在于任务 2，因此任务 3 的任务名称和目标改为“GitLab Issue 与同步生命周期收口”，删除重复的自动同步、退避和运行锁要求。

## 后续 Agent 注意事项

- 不要重建 `ForgeIssuePort` 或第二套自动同步调度器。
- 增加 provider 时优先泛化现有 GitHub 硬编码，而不是复制一套互不一致的同步逻辑。
- 任何同步错误都必须保留已有本地镜像。
