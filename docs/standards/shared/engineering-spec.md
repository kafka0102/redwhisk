# TypeScript 工程规范

## 目标

本文档定义本项目后续引入 TypeScript 与 monorepo 工程层时的通用规则，适用于前端、后端、共享包、构建脚本与工具链配置。

本文档只负责“全局 TypeScript 工程基线”，不负责通用编码风格或某一端的业务实现约束。通用编码风格以 [编码风格](./coding-style.md) 为准。

当前仓库尚未包含 `package.json`、`tsconfig.base.json`、workspace 配置或 TypeScript 应用源码。因此，本规范是新增工程代码时的准入约束，不表示这些文件当前已经存在。

## 适用范围

引入 TypeScript 工程后，适用于以下内容：

- `tsconfig.base.json`
- 各 workspace 的 `tsconfig*.json`
- 前端与后端的 TypeScript 源码
- 构建配置、测试配置与类型检查入口
- monorepo 内部路径别名与 workspace 包引用方式

## 核心原则

### 1. 根配置优先

引入 TypeScript workspace 后必须遵守：

- 所有 workspace `tsconfig` 默认继承根级 `tsconfig.base.json`
- 跨项目共享的 TypeScript 编译基线统一在根级维护
- workspace 级 `tsconfig` 只覆盖本模块确实需要的最小差异

禁止：

- 在局部 `tsconfig` 中复制整份根级配置
- 为了临时通过构建，在子项目里偷偷放宽全局约束

### 2. 路径解析显式一致

引入路径别名或多 workspace 后必须遵守：

- 禁止新增 `compilerOptions.baseUrl`
- 如需路径别名，统一在根级 `tsconfig.base.json` 维护 `paths`
- `paths` 的目标路径必须写成显式相对路径
- workspace 之间的共享能力优先通过包名或统一别名导入，而不是层层 `../`

禁止：

- 使用 `ignoreDeprecations: "6.0"` 静音 `baseUrl` 弃用告警
- 在不同 app 或 package 中各自维护一套不一致的 alias 规则
- 在构建配置文件中使用跨层级相对路径硬连共享配置

说明：

- 后续如采用 ESM + `paths` 管理 workspace 内部别名，不依赖 `baseUrl` 作为根目录查找机制

### 3. ESM 与构建方式统一

引入 TypeScript app 或 package 后必须遵守：

- app 与 package 默认使用 bundler 风格的 ESM 配置
- Node 侧运行时代码应通过 bundler 构建产出，不依赖 `tsc` 直接输出可执行 JS
- 前端 bundler 侧配置继续使用各自框架要求的 ESM 配置，但仍然遵守本规范的路径与别名规则
- 共享 bundler / build helper 应通过 workspace 包或统一脚本导入

禁止：

- 在局部模块中临时切回与全局冲突的 CommonJS 或旧式解析策略
- 把 bundler、测试器、运行时各自配置成不同的模块解析语义

## 推荐检查项

新增 TypeScript app、package 或独立工具模块时，至少检查以下项目：

1. 是否继承根级 `tsconfig.base.json`
2. 是否重新引入了 `baseUrl`
3. 是否把 alias 漂移到局部 `paths`
4. 是否与根级 ESM / bundler 解析策略一致
5. 是否只是做了最小必要的 `tsconfig` 差异覆盖
