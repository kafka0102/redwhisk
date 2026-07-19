# TypeScript 工程规范

## 目标

本文档定义本项目 TypeScript 工程层的通用规则，适用于 React 前端、构建脚本、测试配置与后续可能拆分出的共享包。

本文档只负责“全局 TypeScript 工程基线”，不负责通用编码风格或某一端的业务实现约束。通用编码风格以 [编码风格](./coding-style.md) 为准。

当前仓库已经包含 Vite + React + TypeScript 应用源码，根级配置包括 `package.json`、`tsconfig.json`、`tsconfig.node.json`、`eslint.config.js`、`prettier.config.mjs` 和 `vitest.config.ts`。当前不使用 monorepo workspace，也没有 `tsconfig.base.json`。

## 适用范围

适用于以下内容：

- 根级 `tsconfig.json` 与 `tsconfig.node.json`
- 前端 TypeScript / TSX 源码
- 构建配置、测试配置与类型检查入口
- 路径别名与未来 workspace 包引用方式

## 核心原则

### 1. 当前根配置优先

当前阶段必须遵守：

- TypeScript 编译基线统一在根级 `tsconfig.json` 维护
- Node 侧 Vite/Vitest 配置使用 `tsconfig.node.json`
- 当前配置启用 `strict`、`noUnusedLocals`、`noUnusedParameters` 和 bundler module resolution
- 新增配置只覆盖确实需要的最小差异

禁止：

- 为了临时通过构建而放宽根级类型约束
- 新增局部 `tsconfig` 后复制整份根级配置
- 静音未使用变量、未使用参数或严格类型错误来掩盖实现问题

### 2. 路径解析显式一致

当前代码事实：

- `tsconfig.json` 未设置 `baseUrl`，`paths` 以 tsconfig 所在目录为基准解析
- `paths` 目前包含 `"@/*": ["./src/*"]`
- 当前源码多数仍使用相对路径导入

后续修改路径解析时必须遵守：

- 路径别名统一在根级 `tsconfig.json` 维护
- `paths` 的目标路径必须写成显式相对路径
- 同一 feature 内优先保持现有相对路径风格
- 大范围迁移到 `@/` alias 必须作为单独任务处理，不得混入业务改动

禁止：

- 在不同配置文件中维护不一致的 alias 规则
- 为了少写路径而重排目录结构
- 在 feature 代码中跨层级硬连另一个 feature 的内部实现

### 3. ESM 与构建方式统一

必须遵守：

- `package.json` 使用 `"type": "module"`
- 前端和配置代码默认使用 ESM
- TypeScript 使用 `moduleResolution: "bundler"`，`tsc --noEmit` 只做类型检查
- 构建入口通过 Vite 和 Tauri CLI，不用 `tsc` 直接输出应用 JS

禁止：

- 在局部模块中临时切回与全局冲突的 CommonJS 或旧式解析策略
- 把 bundler、测试器、运行时各自配置成不同的模块解析语义

### 4. 跨边界类型同步

当前项目尚未落地 Rust `serde` 类型自动生成 TypeScript 类型。跨 Tauri command 边界的类型当前由 Rust DTO 与前端 wrapper 手动同步。

新增或修改 DTO 时必须同时更新：

- `src-tauri/src/types/` 下的 Rust 类型
- 对应 `src/features/**/**-commands.ts` 或 `src/shared/commands/` 下的 TypeScript 类型
- command client 或 feature 测试中的示例 payload

禁止：

- 只改 Rust DTO，不改前端类型
- 只在前端新增字段，然后假设后端会返回
- 让前端用 `any` 消化跨边界类型漂移

## 推荐检查项

新增 TypeScript feature、command wrapper 或独立工具模块时，至少检查以下项目：

1. 是否保持根级 strict/bundler/ESM 配置
2. 是否避免跨 feature 直接依赖内部实现
3. 是否与 Rust DTO 或 command payload 同步
4. 是否没有引入 `any`、`@ts-ignore` 或局部放宽类型检查
5. 是否运行了 `pnpm lint` 与 `pnpm typecheck`
