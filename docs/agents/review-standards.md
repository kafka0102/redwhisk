# 审查必读

审查 diff 时，Spec 轴除了票面验收，还要按下条判断。能用脚本拦住的事不写在这里。

## 先核对已有门禁

Standards 写成通过之前，先核对实现回报里同一 tree state 的项目门禁证据：命令、结果、HEAD 与 `git status --short`。证据覆盖本票 diff 时直接复用，不重复跑全量 `pnpm test`；不要另选测试命令。

只有证据缺失、tree state 变了，或你需要独立核验时，才按项目门禁补跑：对 diff 里的前端文件跑 `pnpm lint`，对 diff 里的 Rust 文件跑 `rustfmt --edition 2021 --config skip_children=true --check`。这和 `scripts/hooks/pre-commit` 用的是同一类检查。任一失败，Standards 不通过。格式化 `mod.rs` 时带上 `skip_children=true`，避免改写子模块。

行数看 `scripts/check-rust-file-size.sh` 的结果。它数的是 `rustfmt --edition 2021` 之后的行。

## 每条都能打开

验收写明集合里的每条记录都能打开目标时，目标不在当前内存集合里就直接返回，Spec 不通过。

对应测试要覆盖目标不在该集合里的情况：打开动作仍然到达目标，或界面明确显示找不到。只断言集合里已经有的 id，不算这条验收通过。
