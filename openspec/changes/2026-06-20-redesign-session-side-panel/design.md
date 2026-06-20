# 设计方案

## 关键假设

- 当前阶段以用户确认的静态原型作为视觉基线，不再扩大到真实 Git 数据或真实文件读取。
- 右侧辅助面板复用现有 Issue drawer 所在的右侧空间，但语义从 Issue 详情改为 Session 辅助面板。
- 顶部左右分割图标是打开/关闭右侧辅助面板的主入口；原 `Open Issue` 按钮移除。
- `已提交` 是筛选菜单中的可选项，但内容暂不实现，可显示空态或禁用式占位。

## 技术选型

- 框架：继续使用 React 19 + TypeScript + Vite。
- 图标：继续使用 `lucide-react`，候选图标包括 `Terminal`、`PanelRightOpen` / `PanelRightClose`、`GitBranch`、`RefreshCw`、`FileCode`、`FileJson`、`FileText`、`Folder`、`ChevronDown`。
- UI primitive：优先复用 `src/components/ui/` 中已有 Button、Tabs、Dropdown Menu、Tooltip、Scroll Area 等组件；若现有组件无法满足紧凑布局，只在 feature 层组合，不新增通用组件抽象。
- 数据：本次使用 feature 内 mock 数据常量，显式标记为临时数据；不新增 command wrapper。

## 组件拆分

建议在 `src/features/agents/` 内拆分：

- `AgentsSessionPane`：继续负责组合顶部栏、左侧主内容区和右侧辅助面板。
- `SessionWorkspaceTabs`：管理左侧 `Session`、唯一 `文件`、唯一 `变更` Tab 的渲染与切换。
- `SessionSidePanel`：右侧辅助面板容器，管理 `变更/文件` Tab。
- `SessionChangesPanel`：渲染筛选菜单、刷新按钮和 mock 变更文件列表。
- `SessionFileTreePanel`：渲染 mock 文件树与文件类型图标。

避免把 Tab 状态塞入全局 store；该状态只属于当前选中 Session 工作区。

## 状态模型

左侧主内容区建议使用局部状态：

```ts
type WorkspaceTabKind = "session" | "file" | "changes";

interface WorkspaceFileTab {
  kind: "file";
  fileName: string;
  filePath: string;
}

interface WorkspaceChangesTab {
  kind: "changes";
  fileName: string;
  filePath: string;
}
```

规则：

- `Session` Tab 固定存在，不能关闭。
- 点击文件树文件时，设置或替换 `file` Tab，并激活该 Tab。
- 点击变更文件时，设置或替换 `changes` Tab，并激活该 Tab。
- 关闭可关闭 Tab 时，回到 `Session` Tab。
- 同类 Tab 不新增多个实例；不同类 Tab 可以同时存在一个。

## 右侧变更面板

变更面板使用 mock 数据：

```ts
interface MockChangedFile {
  fileName: string;
  filePath: string;
  added: string;
  deleted: string;
  isNew: boolean;
}
```

展示规则：

- 筛选菜单含 `未提交` 和 `已提交`，触发器保留状态图标与下拉图标。
- `未提交` 显示 mock 文件列表。
- `已提交` 暂不实现，可显示紧凑空态。
- 行宽铺满；文件名在左，新增标签和 `+/-` 统计在右侧。
- `新增` 标签与增删统计之间间距为 `4px`。
- 悬停文件行时用 tooltip 显示 `filePath`。
- 右侧工具区仅保留刷新按钮，点击先无副作用或保留 TODO handler。

## 文件树面板

文件树同样使用 mock 数据，表现为 VS Code 风格：

- 文件夹和文件按层级缩进展示。
- 文件名带类型图标，不同扩展名使用不同颜色。
- 点击文件打开或替换左侧文件 Tab。
- 当前版本不读取真实文件系统，不实现展开/折叠持久化。

## 样式约束

- 保持 RedWhisk 安静、紧凑、可靠的视觉语言。
- 不使用 Card 包裹顶部 Issue 信息区。
- 右侧辅助面板默认宽度 `600px`。
- 顶部 `变更/文件` Tab 行高度与左侧 Agents Issue 行保持一致。
- Diff 占位内容使用更小字号和更紧凑行高。
- 所有按钮必须有 accessible name；选中态不能只靠颜色表达，需保留 `aria-selected` / `aria-pressed`。

## 测试策略

- 更新 Agents Activity 相关 React 测试，覆盖顶部栏文案、按钮移除/新增、右侧面板打开。
- 覆盖点击左右分割图标打开/关闭右侧辅助面板。
- 覆盖点击变更文件只创建/替换一个变更 Tab，Tab 标题为文件名。
- 覆盖点击文件树文件只创建/替换一个文件 Tab，Tab 标题为文件名。
- 覆盖筛选菜单不是原生 `select`，并能切换到 `已提交` 占位。
