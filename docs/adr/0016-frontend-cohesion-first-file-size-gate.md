# ADR 0016：前端单文件大小升级为内聚主判 + 行数门禁

## 状态

采纳（已执行：`frontend-large-component-splitting-rules.md` 更新、`scripts/check-frontend-file-size.sh` 上线、存量进 `frontend-file-size-allowlist.txt`）。

## 背景

`frontend-large-component-splitting-rules.md` 原把单文件约束定为「原则上 ≤ 1000 行」，仅是文字目标，无脚本门禁。实际存量已偏离：`issues-activity.tsx` 1895 行、`agents-activity.tsx` 1883 行接近阈值的 2 倍；另有 9 个文件落在 500–900 行区间——它们多数是一个文件塞进列表 + 表单 + 弹窗 + 数据流多个 UI 边界，**行数只是症状，根因是低内聚**。

纯行数阈值有两个缺陷：1000 太松，500–900 区间的低内聚文件不受约束；只看行数会漏掉「行数不多但职责混杂」的文件。与此同时 [ADR 0013](./0013-feature-first-module-organization.md) 已在后端确立「常规 500 / 编排 800 / 硬上限 1000」三层阈值并由 `check-rust-file-size.sh` 强制，前端缺对称门禁。

## 决定

1. **内聚性升为主判据**：一个 `.tsx` 只承载单一 UI 边界；Activity 容器只做编排，不内联可独立子 UI。即便行数不超标，职责混杂仍应拆分。
2. **行数降为客观兜底**，并与后端对称：常规 ≤ 500、编排容器（`src/features/*/*-activity.tsx`、`src/app/app.tsx`）≤ 800、硬上限 ≤ 1000。
3. **新增 `scripts/check-frontend-file-size.sh`**（复刻后端 bash 3.2 逻辑）：默认只查本次 git 改动触及的源码文件，测试文件与 `src/test/` 不计入；存量超阈值进 `frontend-file-size-allowlist.txt` 过渡，越界且未豁免非零退出，接 `AGENTS.md` §5。
4. 目录组织沿用 [ADR 0013](./0013-feature-first-module-organization.md) 既定方向：语义聚簇子目录（非每组件一文件夹）；测试 co-location。

## 后果

- 前后端共用同一套阈值语言（500 / 800 / 1000），跨边界定位与 review 标准一致。
- 行数门禁有牙齿，阻止 Agent 在单个 `.tsx` 持续堆砌；存量超阈值文件进白名单作为拆分 backlog。
- 内聚主判据仍需人工 review（脚本判不了「多 UI 边界」），脚本守下限、review 拔高。
- 代价：新增脚本 + 白名单维护；改 `frontend-large-component-splitting-rules.md` 与 `AGENTS.md` §4 / §5。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 仅把 1000 降到 500 硬阈值，不引入内聚主判 | 回到纯机械行数，漏掉「行数不多但低内聚」的文件 |
| 只谈内聚、不定行数红线 | 无客观兜底，review 主观、易扯皮 |
| 每个组件一个文件夹（含 index + test） | 与 [ADR 0013](./0013-feature-first-module-organization.md) 否决的「无语义机械切分」冲突，导航更深 |
| ESLint `max-lines` | 不能区分编排容器 800，不如 bash 脚本灵活；与后端机制不对称 |

## 事实来源

- 规范：`docs/architecture-design/frontend-large-component-splitting-rules.md`（更新）、`backend-large-file-splitting-rules.md`（对标）。
- 门禁：`scripts/check-frontend-file-size.sh`、`scripts/frontend-file-size-allowlist.txt`。
- 对称：[ADR 0013](./0013-feature-first-module-organization.md)、`scripts/check-rust-file-size.sh`。
