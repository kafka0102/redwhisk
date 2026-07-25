# 测试与验证策略

测试按最接近行为的层级编写，避免只在 UI 测试中覆盖 Rust 业务规则，或只在 Rust 测试中假设前端 DTO 正确。

## 现有测试布局

| 层级                  | 位置                                         | 覆盖重点                                                  |
| --------------------- | -------------------------------------------- | --------------------------------------------------------- |
| 前端 unit / component | `src/**/*.test.ts(x)`                        | UI、hooks、reducer、formatter、command wrapper、i18n      |
| 前端命令边界          | `src/shared/commands/command-client.test.ts` | command 名、参数形状、错误归一化                          |
| Rust unit             | 各 `src-tauri/src/**/*.rs` 的 `#[cfg(test)]` | service、repository、migration、provider 映射、Git helper |
| Rust integration      | `src-tauri/tests/`                           | local data、project、issue、session、settings 与 Git 检测 |

## 改动—验证映射

| 改动                         | 至少新增/调整                                                | 建议运行                                                  |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| TS/TSX 行为                  | 同 feature 或 command client 测试                            | `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test` |
| Rust 后端 / repository / Git | 同模块 unit 或 `src-tauri/tests/`                            | `cargo test`         |
| Tauri DTO / command          | Rust command/service 测试 + 前端 command client/feature 测试 | 两端相应测试                                              |
| migration                    | migration runner 或 repository 升级测试                      | `cargo test`，并检查旧数据回填                            |
| provider stream / reducer    | Rust event mapper + 前端 reducer/卡片测试                    | 相应 Rust 与 Vitest 测试                                  |
| 纯文档                       | 相对链接、索引、引用与路径                                   | `rg` / 链接检查；无需 lint/typecheck/test                 |
| 依赖变更（`package.json` / lockfile） | 引用该依赖的模块与测试可解析；必要时补 mock                 | 先 `pnpm install`，再 `pnpm format`、`lint`、`typecheck`、相关 `test`，并必跑 `pnpm build` |

## 验收重点

- 每个新 command 至少覆盖一个成功和一个失败路径。
- 每个新状态或分支至少覆盖合法迁移、非法迁移和持久化回读。
- event 测试覆盖乱序/重复、`epoch` 变化或 provider 不支持语义的安全降级。
- migration 测试不能只验证空库；涉及变更/回填时必须验证历史数据。

## 完成前

按 [AGENTS.md](../../AGENTS.md) 的门禁执行。依赖变更或切换含依赖 diff 的提交后先 `pnpm install`。运行 `pnpm format`、lint、typecheck、test、（按需）build 后都要复查 `git status --short`；文档改动至少核对内部相对链接、索引和引用。测试命令可能改写快照或生成文件时，同样复查工作区。注意：`vi.mock` 通过不代表真实依赖已安装，`typecheck`/`build` 仍会检查模块解析。
