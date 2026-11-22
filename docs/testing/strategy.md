# 测试与验证策略

测试按最接近行为的层级编写，避免只在 UI 测试中覆盖 Rust 业务规则，或只在 Rust 测试中假设前端 DTO 正确。

## 现有测试布局

| 层级                  | 位置                                         | 覆盖重点                                                  |
| --------------------- | -------------------------------------------- | --------------------------------------------------------- |
| 前端 unit / component | `src/**/*.test.ts(x)`                        | UI、hooks、reducer、formatter、command wrapper、i18n      |
| 前端真实浏览器测量    | `src/**/*.browser.test.tsx`                  | Chrome 真实布局测量；走 `pnpm test:browser`，默认 `pnpm test` 不包含 |
| 前端命令边界          | `src/shared/commands/command-client.test.ts` | command 名、参数形状、错误归一化                          |
| Rust unit             | 各 `src-tauri/src/**/*.rs` 的 `#[cfg(test)]` | service、repository、migration、provider 映射、Git helper |
| Rust integration      | `src-tauri/tests/`                           | local data、project、issue、session、settings 与 Git 检测 |

## 改动—验证映射

| 改动                         | 至少新增/调整                                                | 建议运行                                                  |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| TS/TSX 行为                  | 同 feature 或 command client 测试                            | `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；涉及真实浏览器测量时另跑 `pnpm test:browser` |
| Rust 后端 / repository / Git | 同模块 unit 或 `src-tauri/tests/`                            | `bash scripts/check-rust-compile.sh`；行为变更再跑对应 `cargo test` 过滤 |
| Tauri DTO / command          | Rust command/service 测试 + 前端 command client/feature 测试 | `bash scripts/check-rust-compile.sh`，再跑两端相应测试    |
| migration                    | migration runner 或 repository 升级测试                      | `bash scripts/check-rust-compile.sh`，再跑对应 `cargo test` 并检查旧数据回填 |
| provider stream / reducer    | Rust event mapper + 前端 reducer/卡片测试                    | `bash scripts/check-rust-compile.sh`，再跑相应 Rust 与 Vitest 测试 |
| 纯文档                       | 相对链接、索引、引用与路径                                   | `rg` / 链接检查；无需 lint/typecheck/test                 |
| 依赖变更（`package.json` / lockfile） | 引用该依赖的模块与测试可解析；必要时补 mock                 | 先 `pnpm install`，再 `pnpm format`、`lint`、`typecheck`、相关 `test`，并必跑 `pnpm build` |

## 验收重点

- 每个新 command 至少覆盖一个成功和一个失败路径。失败路径用 `scripts/check-rust-command-failure-tests.sh` 检查：新增命令要有一个 `#[test]`，函数体里同时出现命令名和 `expect_err`。
- 新共享 seam 至少有一个测试使用下游调用方的真实输入形状（例如代码 Activity 的 `workspacePath`、Session 的 `sessionId`），不能只测先接入的一边。
- 定时轮询或异步 hook 要覆盖“请求在途时隐藏、失焦、切 Tab 或卸载”：失活后恢复必须重新检测并交付正文，不能只推进签名或缓存。
- 每个新状态或分支至少覆盖合法迁移、非法迁移和持久化回读。
- event 测试覆盖乱序/重复、`epoch` 变化或 provider 不支持语义的安全降级。
- migration 测试不能只验证空库；涉及变更/回填时必须验证历史数据。

## 正式构建与测试构建

`src-tauri/Cargo.toml` 把 `warnings` 设为 `deny`。桌面应用编译库和二进制时没有 `cfg(test)`，只被测试引用的 `use` / `pub use` 会变成编译错误。`cargo test` 与 `cargo check --tests` 打开 `cfg(test)`，发现不了这类错误。

改动 Rust 后用 [scripts/check-rust-compile.sh](../../scripts/check-rust-compile.sh) 依次做增量 `cargo check --offline --lib --bins`、`cargo test --offline --lib --no-run` 与 `cargo check --offline --all-targets`。不要用全量测试或 `tauri build` / `pnpm build:macos` 代替。行为是否正确仍靠过滤后的 `cargo test`。

## 完成前

按 [AGENTS.md](../../AGENTS.md) 的门禁执行。依赖变更或切换含依赖 diff 的提交后先 `pnpm install`。运行 `pnpm format`、lint、typecheck、test、（按需）build 后都要复查 `git status --short`；文档改动至少核对内部相对链接、索引和引用。测试命令可能改写快照或生成文件时，同样复查工作区。注意：`vi.mock` 通过不代表真实依赖已安装，`typecheck`/`build` 仍会检查模块解析。Rust 改动还要通过 `scripts/check-rust-compile.sh`，不能只跑 `cargo test`。

## 基线复现：区分「既有失败」与「本次引入」

筛选运行（`vitest run <file> -t <name>`、只跑单个文件）出现失败时，先确认它在本次改动之前的基线上是否同样失败，再决定要不要修。做法是临时检出基线提交，不动当前工作区：

```bash
base=<基线提交 sha，如本次改动开始前的 HEAD>
tmp="$(mktemp -d)"
git worktree add --detach "$tmp/base" "$base"
ln -s "$PWD/node_modules" "$tmp/base/node_modules"   # 复用当前依赖，不重新安装
cd "$tmp/base" && pnpm vitest run <失败的文件> -t "<用例名>"

cd - && git worktree remove --force "$tmp/base" && rmdir "$tmp"   # 清理用 worktree remove，不要 rm -rf
```

判据：基线同样失败 → 既有问题，写进回报但不纳入本次改动；基线通过 → 本次引入，必须在本次修掉。

注意：本仓库部分用例在**过滤运行**下会依赖同文件其它用例的时序（例如 `src/features/issues/issues-activity.test.tsx` 中缺 `await findByRole` 的断言）。门禁口径是**默认全量单测** `pnpm test`（真实浏览器测量另跑 `pnpm test:browser`），过滤运行只用于定位，不作为通过依据。

Rust 定向测试必须使用包装器：

```bash
bash scripts/run-cargo-filter.sh --lib <filter>
bash scripts/run-cargo-filter.sh --test <test-target> [filter]
```

包装器先用 `--list` 确认至少命中一个测试，再执行真实测试；过滤零命中必须失败。直接使用 `cargo test <filter>` 只适合全量或你已独立确认命中时。

有效红测必须进入目标行为并因预期缺陷失败。测试过滤零命中、无关 import/编译错误、模块路径写错或 fixture 路径错误都不是红；这些状态不能作为 TDD 的红测证据。

## 文件树右键菜单

改文件树右键菜单或行内新建草稿时，行为测试在这三处：

- [file-tree-panel.test.tsx](../../src/shared/workspace/file-tree-panel.test.tsx)
- [workspace-path-context-menu.test.tsx](../../src/shared/workspace/workspace-path-context-menu.test.tsx)
- [file-tree-draft-typing.test.tsx](../../src/shared/workspace/file-tree-draft-typing.test.tsx)

通过口径仍是全量 `pnpm test`。
