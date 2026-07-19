# 前端大型组件拆分规则

## 目标

当单个 TypeScript / TSX 文件承载多个 UI 边界、多个业务职责或混杂的编排逻辑时，应优先按稳定 UI 边界拆分，降低单文件代码量，同时保持运行时行为与性能特征不变。

本规则是 [Agent 开发通用规则](./agent-development-rules.md) 中「前端文件复杂度与组件化」规则的专项补充，并与 [后端 Rust 大文件拆分规则](./backend-large-file-splitting-rules.md) 对称。它把 [ADR 0016](../adr/0016-frontend-cohesion-first-file-size-gate.md) 已采纳的「内聚主判 + 行数兜底 500 / 800 / 1000」落地为强制门禁。

## 内聚主判据

行数不是唯一指标，**内聚性是主判据**：一个 `.tsx` 应只承载**单一 UI 边界**（一个面板 / 一个对话框 / 一个列表区 / 一个表单），不混合多个独立交互单元。

- **Activity 容器**（`features/**/*-activity.tsx`、`app/app.tsx`）只保留数据加载、Tauri command 调用、跨弹窗状态、选中项、焦点恢复和错误归属；列表、表单、侧栏动作区、预览弹窗等可独立的子 UI 一律抽为同 feature 下的组件。
- **叶子 / 子组件**优先做受控组件，通过 props 接收状态、ref 和回调；不在子组件中重复请求同一数据。
- 仅在多个 feature 真实复用时才移动到 `src/components/ui/` 或共享目录；单一 feature 内的组件留在对应 `src/features/{feature}/`。
- 类型若被父组件和多个子组件共同使用，可以抽到同 feature 的轻量类型文件。

当一个文件即便行数不多，却塞进多个 UI 边界或多套数据流时，仍应按上述边界拆分。内聚主判据由人工 review 把关；下面的行数阈值是它的客观兜底。

## 行数阈值

- 常规 `.ts` / `.tsx` ≤ **500 行**。
- 编排容器 ≤ **800 行**：相对仓库根路径匹配 `src/features/*/*-activity.tsx` 或 `src/app/app.tsx`。
- 硬上限 ≤ **1000 行**：任何文件不得超过，含编排容器。

阈值由 `scripts/check-frontend-file-size.sh` 强制执行，`AGENTS.md` §5 质量门禁在每次改动前端源码后调用。测试文件（`*.test.ts(x)`、`*.spec.*`）与 `src/test/` 基础设施不计入。

## 门禁触发模型

- 门禁默认只检查本次 git 改动触及的 `.ts` / `.tsx` 源码文件（已跟踪改动 + 未跟踪新文件），不扫全仓。
- 越界文件若在 `scripts/frontend-file-size-allowlist.txt` 中登记 → 跳过并提示「存量待拆分」。
- 越界且未登记 → 脚本非零退出，任务不算完成（见 `AGENTS.md` §5）。
- 白名单仅登记「本次改动前已超阈值」的存量文件；**禁止把新建文件塞进白名单**，脚本会检测并报错。
- 维护白名单：`bash scripts/check-frontend-file-size.sh --all --names-only` 列出当前全部超阈值文件。

## 目录组织

大 feature 内部按 UI 边界做**语义聚簇子目录**，而非把每个组件单独建文件夹：

- 延续 `features/agents/{composer,message-stream,session-notifications,session-list,session-pane,session-side-panel,session-workspace}/`、`features/issues/{issue-completion,issue-detail,issue-form,issue-run}/` 的先例，把一个业务区的整套生态（组件 + hooks + 类型 + 测试）装进一个子目录。
- **何时建子目录、何时平铺**：当一组文件围绕同一 UI 边界形成完整生态、且文件数 ≥ 6 或存在多个独立 UI 边界时，按语义聚簇拆子目录；文件少且职责单一时平铺在 feature 根目录，不为凑结构建单文件子目录。
- 不做「每个组件一个文件夹（内含 index + test）」式的无语义机械切分——它会让 feature 目录平摊出大量各装 1–2 文件的子目录，导航深度不降反升（见 [ADR 0013](../adr/0013-feature-first-module-organization.md) 对「无语义机械切分」的否决）。
- 测试与源码 co-location（`.test.ts(x)` 与被测文件同目录），沿用 [测试策略](../testing/strategy.md) 既定布局。

## 性能规则

- 拆分组件前后不得增加 IPC、网络、文件系统或数据库调用次数。
- 拆分组件前后不得把原本父组件中的派生数据计算复制到多个子组件中。
- 原有 `useMemo`、`useRef`、受控输入和焦点管理语义应保持不变。
- 不为了「拆文件」默认添加 `React.memo`、缓存层或全局状态；只有实际性能证据表明渲染成本可观时再加。
- 对纯 JSX 移动，父组件更新导致子组件重新渲染与原先同一 JSX 树重新求值等价，通常不会造成可感知性能回退。

## 验收要求

- 重构应保持现有可访问名称、按钮文案、DOM role、键盘行为和错误展示行为。
- TypeScript 源码改动后至少运行 `pnpm lint` 和 `pnpm typecheck`。
- 涉及渲染逻辑、交互分支或测试依赖实现时，还必须运行受影响测试。
- 改动前端源码后运行 `bash scripts/check-frontend-file-size.sh`，确认无未豁免越界。
- 文档中应记录新增组件边界与性能判断，便于后续继续拆分同类文件。
