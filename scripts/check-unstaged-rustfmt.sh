#!/usr/bin/env bash
# 未暂存的 src-tauri Rust 文件若与 HEAD 经 rustfmt 后的结果一致，说明只是格式化。
# 这种改动拒绝提交，并列出要还原的路径。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUSTFMT_SCOPE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$REPO_ROOT"

if ! command -v rustfmt >/dev/null 2>&1; then
  echo "未找到 rustfmt，无法判断未暂存 Rust 是否为纯格式化。" >&2
  exit 1
fi

fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  head_file="$tmp/head.rs"
  formatted="$tmp/formatted.rs"
  if ! git show "HEAD:$path" >"$head_file" 2>/dev/null; then
    continue
  fi
  cp "$head_file" "$formatted"
  if ! rustfmt --edition 2021 --config skip_children=true "$formatted" >/dev/null 2>&1; then
    continue
  fi
  if cmp -s "$formatted" "$path"; then
    echo "还原 ${path}：未暂存改动与 rustfmt --edition 2021 的结果一致。" >&2
    fail=1
  fi
done < <(git diff --name-only --diff-filter=M | grep -E '^src-tauri/.+\.rs$' || true)

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
