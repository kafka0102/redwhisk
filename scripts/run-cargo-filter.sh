#!/usr/bin/env bash
# 执行 Rust 聚焦测试；过滤未命中任何用例时直接失败，避免 cargo test 以 0 退出。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CARGO_BIN="${CARGO_BIN:-cargo}"
CARGO_ROOT="${CARGO_ROOT:-${REPO_ROOT}/src-tauri}"

usage() {
  cat <<'USAGE'
用法:
  run-cargo-filter.sh --lib <filter>
  run-cargo-filter.sh --test <test-target> [filter]

先执行 `cargo test ... -- --list` 确认过滤至少命中一个测试，再执行真实测试。
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 ]]; then
  usage >&2
  exit 2
fi

selector="$1"
shift
case "${selector}" in
  --lib)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    cargo_args=(test --lib "$1")
    ;;
  --test)
    if [[ $# -lt 1 || $# -gt 2 ]]; then
      usage >&2
      exit 2
    fi
    cargo_args=(test --test "$1")
    if [[ $# -eq 2 ]]; then
      cargo_args+=("$2")
    fi
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

cd "${CARGO_ROOT}"

list_output="$("${CARGO_BIN}" "${cargo_args[@]}" -- --list)"
matched="$(
  printf '%s\n' "${list_output}" |
    awk '/: test$/ { count += 1 } END { print count + 0 }'
)"
if [[ "${matched}" -eq 0 ]]; then
  printf '错误：Rust 聚焦测试过滤未命中任何测试。\n' >&2
  printf 'cargo %s\n' "${cargo_args[*]}" >&2
  exit 1
fi

printf '==> Rust 聚焦测试命中 %s 项：cargo %s\n' "${matched}" "${cargo_args[*]}"
exec "${CARGO_BIN}" "${cargo_args[@]}"
