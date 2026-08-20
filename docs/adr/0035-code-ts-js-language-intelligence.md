# 0035. 代码页 TS/JS 语言智能：项目 TypeScript 语言服务，不引入插件宿主

## 状态

采纳（待执行）。

## 背景

代码 Activity 现用 Monaco 做浏览与轻量编辑。[ADR-0028](./0028-code-workspace-lightweight-edit.md) 为避免误报，关闭了 TS/JS 诊断，并写明「不是完整 IDE」。用户需要接近 VS Code 的准确语法/语义诊断与调用导航，但产品仍不是 AI 编辑器，也不应引入插件市场或 VS Code 插件宿主。Monaco 自带 `ts.worker` 只看见已打开模型，没有项目 `tsconfig` / 模块解析，不能满足「准确」。

## 决定

1. 修订 ADR-0028「无诊断」：允许 **TS/JS 语言智能**（诊断、定义跳转、查找引用），其余轻量编辑约束不变（默认只读、无自动保存、无重构套件、无跨根编辑缓冲）。
2. 只作用于代码 Activity 当前代码根内的 TypeScript / JavaScript（含 TSX/JSX）；会话文件查看器与变更 diff 不启用。
3. 分析上下文跟随该根 `tsconfig`/`jsconfig` 与项目 TypeScript；无配置文件时用推断项目。优先 `node_modules/typescript`，没有则用应用内置；本机无 Node 则不可用并在编辑器内轻量提示。
4. **不**引入 VS Code 插件宿主 / 插件市场；不靠内置第三方编辑器插件实现 TS/JS 智能。
5. 不做补全、类型悬停、问题列表面板。

## 后果

- 需在代码页接入项目级 TypeScript 语言服务（而非仅打开 Monaco 诊断），并随代码根切换重绑定。
- 应用需内置一份 TypeScript 作为回退，影响包体与版本策略。
- ADR-0028 的「不是完整 IDE」仍然有效；后续不得借语言智能扩展成通用 IDE。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 打开 Monaco 内置 TS/JS 诊断 | 无项目上下文，误报正是当初关闭诊断的原因 |
| 做成接近 VS Code 的 TS/JS IDE（补全/悬停/问题面板） | 超出代码工作区定位，违背「不是完整 IDE」 |
| 内置 VS Code 插件宿主或 TypeScript 扩展 | 过重，且 TS/JS 准确度来自项目 TypeScript 语言服务而非插件市场 |
| 只分析当前打开文件 | 无法准确做模块跳转与项目级诊断 |
