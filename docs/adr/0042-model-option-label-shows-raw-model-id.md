# 0042. Agent 模型选项标签展示模型 id 原文

## 状态

采纳（已执行）。

## 背景

模型下拉标签此前取的是模型目录条目的 `display_name`（ADR-0036 第 2 条），而用户在本机配置里写的是模型 id。两者不一致时，用户看到的就不是自己配置的那个名字：本机上存在 `slug = "deepseek-flash"` 对应 `display_name = "DeepSeek-Flash"`、`slug = "grok-4.7"` 对应 `display_name = "Grok 4.6"` 这样的条目，于是「改了模型配置，下拉还显示旧名称」被误当成缓存问题（已核实无缓存：后端每次调用重读本机文件，Run Dialog 每次打开重新请求）。

composer 另有一处纯前端改写：把标签开头的 `gpt` 改写成 `GPT`，同样让标签与传给 CLI 的模型 id 对不上。

用户诉求是「原始配置是什么就展示什么」。

## 决定

1. **展示字段是模型 id 原文**：模型选项标签取模型 id——Codex 取模型目录条目 / CLI 模型缓存条目的 `slug` 或内置模型回退条目的 id，Grok 取配置里的模型别名，Claude 取官方别名或第三方网关下的真实模型名——**原样展示**，不做大小写、分隔符或任何形式的改写。
2. **删除前端改写逻辑**：composer 此前把标签开头 `gpt` 改写成 `GPT` 的私有格式化函数随本决策删除，前端不再存在任何模型标签改写。
3. **两处入口同一口径**：Issue Run Dialog 的选项标签与当前选中标签、composer 的下拉选项、当前模型标签与只读模型标签（第三方网关或不支持切换的 provider）都展示模型 id 原文。
4. **展示规则不变**：沿用 ADR-0036 第 9 条——Run Dialog 条目数 ≥ 2 且列表非只读才渲染下拉，只读或条目不足不渲染，加载中显示占位，加载失败显示错误文案且不阻断启动；默认选中项与提交给后端的模型参数（仍为模型 id）不变。
5. **后端与跨边界契约不变**：模型来源解析与 `display_name` 下发都保持原样，`display_name` 只是不再用于展示，避免跨边界契约与 parity 快照的无谓改动。
6. **取代 ADR-0036 第 2 条中的展示口径**：`slug` 为模型 id、`display_name` 映射为展示名这一条不再成立；同条内的 `default_reasoning_level` / `supported_reasoning_levels` 映射为 effort 能力不受影响。

## 后果

- 下拉标签与用户在配置文件里写的模型 id、以及实际传给 CLI 的 `-m` 参数完全一致，改完配置重开 Run Dialog 即可确认生效。
- 模型目录里的 `display_name` 不再出现在界面上；希望看到「更好看」的名字的用户需要改自己配置里的模型 id。
- 展示口径只有一处规则（模型 id 原文），Run Dialog 与 composer 不会再出现同一模型两种写法。
- 文档口径同步：ADR-0036 第 2 条的展示部分由本 ADR 取代，`CONTEXT.md` 的「模型目录」词条同口径。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 继续用 `display_name` 当展示名 | 正是用户诉求的反面：展示的名字和本机配置对不上，也无法判断配置是否生效 |
| `display_name` 存在时展示它、否则回退模型 id | 同一份配置会出现两套口径，且改动本机文件后仍可能显示旧名称 |
| 只删 composer 的 `gpt` → `GPT` 改写，Run Dialog 继续用 `display_name` | 两处入口口径不一致，Issue 的两个现象都只解决一半 |
| 在展示层统一美化大小写（如首字母大写） | 用户要的是与配置原文一致，任何改写都会让它对不上 `-m` 参数 |

## 代码事实来源

- Run Dialog 展示：`src/features/issues/issue-run/run-model-select.tsx`、`src/features/issues/issue-run/use-run-agent-model.ts`
- composer 展示：`src/features/agents/composer/composer-controls.tsx`、`src/features/agents/composer/use-agent-models.ts`
- 被取代的展示口径：[0036](./0036-agent-model-list-from-local-config.md) 第 2 条
- 领域语言：`CONTEXT.md`（模型目录 / 内置模型回退列表 / 启动期模型选择 / 运行参数模型）
