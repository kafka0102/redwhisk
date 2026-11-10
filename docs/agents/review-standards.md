# 审查必读

审查 diff 时，Spec 轴除了票面验收，还要按下条判断。能用脚本拦住的事不写在这里。

## 先跑已有门禁

Standards 写成通过之前，对 diff 里的前端文件跑 `pnpm lint`，对 diff 里的 Rust 文件跑 `rustfmt --edition 2021 --check`。这和 `scripts/hooks/pre-commit` 用的是同一类检查。任一失败，Standards 不通过。

行数看 `scripts/check-rust-file-size.sh` 的结果。它数的是 `rustfmt --edition 2021` 之后的行。

## 每条都能打开

验收写明集合里的每条记录都能打开目标时，目标不在当前内存集合里就直接返回，Spec 不通过。

对应测试要覆盖目标不在该集合里的情况：打开动作仍然到达目标，或界面明确显示找不到。只断言集合里已经有的 id，不算这条验收通过。
