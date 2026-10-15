#!/usr/bin/env bash
# 正式构建口径的 Rust 编译检查。
# 只对库和二进制做 dev profile 的 cargo check：不跑测试、不生成机器码、不链接、不打 Tauri 包。
# 规范: docs/architecture-design/agent-development-rules.md「测试与验证规则」
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RRC_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

cd "$REPO_ROOT/src-tauri"

# --lib --bins 对应桌面应用会编译的 crate。
# 不要加 --tests / --all-targets：cfg(test) 会把仅测试引用的重导出算作已使用，
# 漏掉正式构建里 warnings=deny 的 unused import。
# 不要加 --release：release 的 lto 与单 codegen-unit 只用于发版。
echo "Rust 正式构建检查: cargo check --offline --lib --bins"
cargo check --offline --lib --bins
