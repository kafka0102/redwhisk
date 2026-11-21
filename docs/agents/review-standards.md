# 审查必读

审查 diff 时，Spec 轴除了票面验收，还要按下条判断。能用脚本拦住的事不写在这里。

## 先核对已有门禁

Standards 写成通过之前，先核对实现回报里同一 tree state 的项目门禁证据：命令、结果、HEAD 与 `git status --short`。证据覆盖本票 diff 时直接复用，不重复跑全量 `pnpm test`；不要另选测试命令。

只有证据缺失、tree state 变了，或你需要独立核验时，才按项目门禁补跑：对 diff 里的前端文件跑 `pnpm lint`，对 diff 里的 Rust 文件跑 `bash scripts/check-rustfmt.sh --files <那些文件>`。这条和 pre-commit 的 `bash scripts/check-rustfmt.sh --cached`、CI 的 `bash scripts/check-rustfmt.sh --from <base>` 是同一个脚本。`scripts/check-rust-file-size.sh` 只在临时副本上跑 rustfmt 来数行，不能代替它。任一失败，Standards 不通过。格式化 `mod.rs` 时带上 `skip_children=true`，避免改写子模块。

行数看 `scripts/check-rust-file-size.sh` 的结果。它数的是 `rustfmt --edition 2021` 之后的行。

diff 在 `src/` 下只多了 `src/shared/commands/__parity__/rust-dto-signatures.json` 时，复用 `pnpm test:parity` 的证据。不要为此再跑 `bash scripts/check-frontend-gates.sh`。字段名与契约是否一致仍看 `bash scripts/check-rust-command-dto.sh`，它不核对这份快照。

## 票面之外的文件

diff 里每个改动文件都要能对上本票验收。对不上的，Standards 不通过。

全量测试在票面之外的文件变红时，那处修复另提交，不并进本票。

## 每条都能打开

验收写明集合里的每条记录都能打开目标时，目标不在当前内存集合里就直接返回，Spec 不通过。

对应测试要覆盖目标不在该集合里的情况：打开动作仍然到达目标，或界面明确显示找不到。只断言集合里已经有的 id，不算这条验收通过。
