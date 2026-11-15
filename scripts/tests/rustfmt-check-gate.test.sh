#!/usr/bin/env bash
# 契约测试：本次改动的 Rust 必须已经 rustfmt。全仓不要求 fmt-clean。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

gate="scripts/check-rustfmt.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "==> 已格式化的文件通过"
ok_file="${tmp_dir}/ok.rs"
printf 'fn main() {}\n' >"${ok_file}"
output="$(bash "${gate}" --files "${ok_file}")" || fail "已格式化文件应通过：${output}"

echo "==> 未格式化的文件失败"
bad_file="${tmp_dir}/bad.rs"
printf 'fn  main( ) {}\n' >"${bad_file}"
if output="$(bash "${gate}" --files "${bad_file}")"; then
  fail "未格式化文件应失败：${output}"
fi
[[ "${output}" == *"[VIOLATION]"* ]] || fail "缺少违规提示：${output}"
[[ "${output}" == *"bad.rs"* ]] || fail "违规提示应带上文件：${output}"

echo "==> 非 Rust 文件不检查"
note_file="${tmp_dir}/note.md"
printf 'fn  main( ) {}\n' >"${note_file}"
output="$(bash "${gate}" --files "${note_file}")" || fail "非 Rust 文件不应失败：${output}"
[[ "${output}" == *"(无待检查的 Rust 文件)"* ]] || fail "非 Rust 文件应记为空检查：${output}"

echo "==> 未跟踪的未格式化文件失败"
sample="${tmp_dir}/repo"
mkdir -p "${sample}/src-tauri/src"
git -C "${sample}" init -q -b main
printf 'fn  draft( ) {}\n' >"${sample}/src-tauri/src/draft.rs"
if output="$(RUSTFMT_CHECK_ROOT="${sample}" bash "${gate}")"; then
  fail "未跟踪的未格式化文件应失败：${output}"
fi
[[ "${output}" == *"draft.rs"* ]] || fail "应点名未跟踪文件：${output}"

echo "==> 已暂存的未格式化文件在 --cached 下失败"
git -C "${sample}" add src-tauri/src/draft.rs
if output="$(RUSTFMT_CHECK_ROOT="${sample}" bash "${gate}" --cached)"; then
  fail "已暂存的未格式化文件应失败：${output}"
fi
[[ "${output}" == *"draft.rs"* ]] || fail "暂存检查应点名文件：${output}"

echo "==> 格式化后 --cached 通过"
rustfmt --edition 2021 --config skip_children=true "${sample}/src-tauri/src/draft.rs"
git -C "${sample}" add src-tauri/src/draft.rs
output="$(RUSTFMT_CHECK_ROOT="${sample}" bash "${gate}" --cached)" || fail "格式化后的暂存文件应通过：${output}"

echo "rustfmt check gate ok"
