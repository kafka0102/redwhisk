#!/usr/bin/env bash
# 检查本次改动的 Rust 源文件是否已经 rustfmt。
# check-rust-file-size.sh 只在临时副本上格式化后再数行，源文件未格式化也能通过。
# 全仓不是 fmt-clean，本脚本不扫未改动的文件。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUSTFMT_CHECK_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

usage() {
  cat <<'USAGE'
用法:
  check-rustfmt.sh                  检查未提交的 src-tauri/**/*.rs（含未跟踪）
  check-rustfmt.sh --cached         只检查已暂存的 src-tauri/**/*.rs（pre-commit）
  check-rustfmt.sh --from <ref>     检查 <ref>..HEAD 的 src-tauri/**/*.rs（CI / 提交后复查）
  check-rustfmt.sh --files f1 f2    检查指定文件
未找到 rustfmt 时失败。没有 Rust 改动时退出 0。
USAGE
}

mode=worktree
FROM_REF=""
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cached) mode=cached; shift ;;
    --from)
      mode=from
      FROM_REF="${2:-}"
      if [[ -z "$FROM_REF" ]]; then
        echo "缺少 --from 的 ref" >&2
        exit 2
      fi
      shift 2
      ;;
    --from=*)
      mode=from
      FROM_REF="${1#--from=}"
      shift
      ;;
    --files) mode=files; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ "$mode" != files ]]; then
        echo "未知参数：$1" >&2
        usage >&2
        exit 2
      fi
      files+=("$1")
      shift
      ;;
  esac
done

if ! command -v rustfmt >/dev/null 2>&1; then
  echo "未找到 rustfmt，无法检查本次改动的 Rust 格式。" >&2
  exit 1
fi

if [[ "$mode" == from ]]; then
  if ! git -C "$REPO_ROOT" rev-parse --verify -q "${FROM_REF}^{commit}" >/dev/null; then
    echo "无法解析 --from ${FROM_REF}" >&2
    exit 2
  fi
fi

collect_paths() {
  case "$mode" in
    worktree)
      if git -C "$REPO_ROOT" rev-parse --verify -q HEAD >/dev/null; then
        git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR HEAD -- src-tauri 2>/dev/null || true
      fi
      git -C "$REPO_ROOT" ls-files --others --exclude-standard -- src-tauri 2>/dev/null || true
      ;;
    cached)
      git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=ACMR -- src-tauri 2>/dev/null || true
      ;;
    from)
      git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$FROM_REF" HEAD -- src-tauri 2>/dev/null || true
      ;;
    files)
      if [[ ${#files[@]} -eq 0 ]]; then
        return 0
      fi
      printf '%s\n' "${files[@]}"
      ;;
  esac
}

warn_noop() {
  [[ "$mode" == worktree ]] || return 0
  local base counted=0 rel
  base="$(git -C "$REPO_ROOT" rev-parse --verify -q HEAD~1 2>/dev/null || true)"
  [[ -n "$base" ]] || return 0
  while IFS= read -r rel; do
    [[ "$rel" == *.rs ]] || continue
    counted=$((counted + 1))
  done < <(git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$base" HEAD -- src-tauri 2>/dev/null || true)
  (( counted > 0 )) || return 0
  echo
  printf '  [告警] HEAD 提交触及 %s 个 Rust 文件，但工作区无未提交改动：本次运行属于空转，未检查任何文件。\n' "$counted"
  echo "         改动已提交时用 --from 复查，例如："
  echo "         bash scripts/check-rustfmt.sh --from HEAD~1"
}

fail=0
checked=0
while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  [[ "$rel" == *.rs ]] || continue
  if [[ "$rel" == /* ]]; then
    path="$rel"
    label="$rel"
  else
    path="$REPO_ROOT/$rel"
    label="$rel"
  fi
  if [[ ! -f "$path" ]]; then
    if [[ "$mode" == files ]]; then
      echo "  [VIOLATION] 找不到 ${label}"
      fail=1
    fi
    continue
  fi
  checked=$((checked + 1))
  if ! rustfmt --edition 2021 --config skip_children=true --check "$path"; then
    echo "  [VIOLATION] ${label} 未通过 rustfmt --edition 2021 --config skip_children=true --check"
    fail=1
  fi
done < <(collect_paths)

if (( checked == 0 && fail == 0 )); then
  echo "  (无待检查的 Rust 文件)"
  warn_noop
fi

exit "$fail"
