# 0041. 变更 Activity 切回先回填上次快照再后台复检

## 状态

采纳（已执行）。

## 背景

顶层 Activity 互斥渲染（`activity-router.tsx` 条件渲染，仅终端走 keep-alive）：离开变更页会
整棵卸载 `ChangesActivity`，`useCodeWorkspaceChanges` 的列表数据（未提交变更 / 已提交历史）
只存在 hook state，切回必然清空重拉，且首拉走 `clearStale` 路径先进 loading。表现为未提交面板
闪「暂无未提交变更 / 未提交变更 (0)」、已提交面板闪「正在加载」，而多数时候数据根本没变。
ADR-0008 的「进入视图即拉取一次」在 Activity 卸载模型下退化为「每次进入都闪一次加载态」。

同项目的对称能力已在「代码」Activity 落地：文件树按「项目 + 工作区根」做运行期内存 SWR 缓存，
切回代码页先展示缓存且不闪加载态（`src/features/code/use-code-workspace-file-tree.ts`）。

## 决定

1. **进程内快照缓存**：未提交变更与已提交历史各自缓存最近一次成功响应，按
   **「项目 + 工作区路径」** 键控（`changes-workspace-cache.ts` 的
   `workspaceChangesDataCache` / `workspaceCommitHistoryDataCache`）。module-level Map，随应用
   退出释放，**不持久化**——列表非业务状态（唯一事实源仍是 SQLite 与 git 工作区），且必须与 git
   实时状态一致。
2. **挂载首帧回填**：挂载时用惰性 state 直接读快照，首帧即上次数据（不闪空态）；`workspacePath`
   变化时同一 effect 先回填该根快照（ref 同步补齐、state 走微任务）再发请求。
3. **有快照走 soft revalidate**：不发 loading，响应 signature 与快照相同则零 setState，变化则静默
   替换；无快照（首次访问该根）沿用原 `clearStale` / `initial` 语义，清空旧根数据并进 loading。
4. **快照随展示数据写入**：仅在「展示数据被替换」时写快照（含 load-more 追加后的整窗）；load-more
   场景 signature 置空，强制下次整窗刷新应用。失败 / 不可恢复错误不写、不清空快照。
5. **分页窗口不退回首页**：恢复的窗口长度作为 `commitHistoryRefreshLimit` 基准，重挂载后按
   `max(50, 已加载条数)` 整窗刷新。

## 后果

- 切回变更页或切到曾访问过的根：立即看到上次列表，无 loading 空窗，后台异步复检发现变化再静默替换。
- 快照只在进程内：重启应用后首次进入该根仍进 loading，与代码页文件树一致。
- 不清理已失效 worktree 的快照条目（少量内存，随进程释放）；不缓存 error / unavailable 态，避免陈旧
  错误误导，错误由本次请求重新判定。
- 轮询 / 手动刷新 / 拉取推送后刷新路径不变，仍走既有 soft revalidate 与 signature 去重。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 把 changes 也加入 `activity-keep-alive` | 与 ADR-0018「diff 不跨 code↔changes 保留」冲突，且常驻整棵 DOM 成本更高 |
| 只缓存选中根 / 折叠态等 UI 态 | 不能解决「切回必闪加载」，列表数据才是重拉的来源 |
| 持久化到 localStorage / SQLite | 列表非业务状态，且需与 git 实时状态一致，陈旧快照风险大于收益 |
| 维持每次重挂载 clearStale + loading（现状） | 用户明确反馈该体验糟糕 |
| 快照里一并缓存 error / unavailable 态 | 陈旧错误会误导用户，错误态应由本次请求重新判定 |

## 代码事实来源

- 实现：`src/features/changes/use-code-workspace-changes.ts`、`src/features/changes/changes-workspace-cache.ts`
- 卸载根因：`src/app/activity-router.tsx`（顶层条件渲染，仅 terminals keep-alive）
- 对称能力：`src/features/code/use-code-workspace-file-tree.ts`（文件树 SWR 缓存）
- 领域语言：`CONTEXT.md`（变更 Activity）
- 相关 ADR：[0008](./0008-changes-promoted-to-activity-with-conditional-polling.md)、[0009](./0009-changes-split-into-own-feature-dir.md)、[0018](./0018-code-changes-independent-activities.md)
