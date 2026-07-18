#!/usr/bin/env bash
# 前端单文件大小门禁脚本
# 规范: docs/architecture-design/frontend-large-component-splitting-rules.md
# 阈值（沿用 ADR 0016，与后端对称）: 常规 500 / 编排容器 800 / 硬上限 1000
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${FFS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SRC_ROOT="$REPO_ROOT/src"
ALLOWLIST="${FFS_ALLOWLIST:-$SCRIPT_DIR/frontend-file-size-allowlist.txt}"

LIMIT_REGULAR=500
LIMIT_ORCHESTRATION=800
LIMIT_HARD=1000

# 相对仓库根的路径（用于显示与通配判定）
relpath() {
  local f="$1"
  if [[ "$f" == "$REPO_ROOT"/* ]]; then
    echo "${f#"$REPO_ROOT"/}"
  else
    echo "$f"
  fi
}

# 返回文件适用的阈值（编排容器 800，其余 500）
threshold_for() {
  local rel="$1"
  if [[ "$rel" == src/features/*/*-activity.tsx ]] \
     || [[ "$rel" == src/app/app.tsx ]]; then
    echo "$LIMIT_ORCHESTRATION"
  else
    echo "$LIMIT_REGULAR"
  fi
}

# 是否计入门禁的源码文件：是 .ts/.tsx，且非测试文件、非 src/test/ 基础设施
is_counted_source() {
  local rel="$1"
  [[ "$rel" == *.ts || "$rel" == *.tsx ]] || return 1
  [[ "$rel" == *.test.ts || "$rel" == *.test.tsx || "$rel" == *.spec.ts || "$rel" == *.spec.tsx ]] && return 1
  [[ "$rel" == src/test/* ]] && return 1
  return 0
}

# 打印白名单相对路径（去掉注释与首尾空白），忽略空行
allowlist_paths() {
  [[ -f "$ALLOWLIST" ]] || return 0
  awk '{
    sub(/\r$/,"");
    line=$0;
    sub(/#.*/,"",line);
    gsub(/^[ \t]+|[ \t]+$/,"",line);
    if (line!="") print line
  }' "$ALLOWLIST"
}

is_allowlisted() {
  local rel="$1" p
  while IFS= read -r p; do
    [[ "$p" == "$rel" ]] && return 0
  done < <(allowlist_paths)
  return 1
}

# 判定单个文件是否超阈值；超阈值则 stdout 打印 "<kind>|<threshold>"
# kind=hard 表示超硬上限，kind=over 表示超类型阈值
classify() {
  local f="$1" rel lines thr
  rel="$(relpath "$f")"
  is_counted_source "$rel" || return 0
  [[ -f "$f" ]] || return 0
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  thr="$(threshold_for "$rel")"
  if (( lines > LIMIT_HARD )); then
    printf 'hard|%s\n' "$LIMIT_HARD"
  elif (( lines > thr )); then
    printf 'over|%s\n' "$thr"
  fi
  return 0
}

VIOL=0

# 检查单个文件并打印报告；违规则 VIOL++
report_file() {
  local f="$1" rel lines cls
  rel="$(relpath "$f")"
  is_counted_source "$rel" || return 0
  [[ -f "$f" ]] || return 0
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  if is_allowlisted "$rel"; then
    printf '  [allowlisted] %s (%s lines, 存量待拆分)\n' "$rel" "$lines"
    return 0
  fi
  cls="$(classify "$f")"
  if [[ -n "$cls" ]]; then
    local kind="${cls%%|*}" thr="${cls##*|}"
    if [[ "$kind" == hard ]]; then
      printf '  [VIOLATION] %s: %s lines > 硬上限 %s\n' "$rel" "$lines" "$thr"
    else
      printf '  [VIOLATION] %s: %s lines > 阈值 %s\n' "$rel" "$lines" "$thr"
    fi
    VIOL=$((VIOL+1))
  fi
}

# 白名单护栏：白名单内文件不得是仓库内「无 git 历史」的新建文件
# --files 模式下跳过显式入参的条目；git 模式下校验全部白名单条目，避免漏过新建文件。
check_allowlist_no_new_files() {
  [[ -f "$ALLOWLIST" ]] || return 0
  local p f skip
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    [[ -f "$REPO_ROOT/$p" ]] || continue
    if [[ "$mode" == "files" ]]; then
      skip=0
      for f in "${files[@]+"${files[@]}"}"; do
        if [[ "$(relpath "$f")" == "$p" ]]; then
          skip=1
          break
        fi
      done
      [[ "$skip" == 1 ]] && continue
    fi
    if ! git -C "$REPO_ROOT" log -1 --format=%H -- "$p" 2>/dev/null | grep -q .; then
      printf '  [VIOLATION] 白名单包含新建文件 %s（白名单仅登记存量，禁止放入新建文件）\n' "$p"
      VIOL=$((VIOL+1))
    fi
  done < <(allowlist_paths)
}

collect_changed_frontend_files() {
  # pathspec 用目录前缀 src；非源码（测试文件、src/test/）由 is_counted_source 过滤。
  git -C "$REPO_ROOT" diff --name-only HEAD -- src 2>/dev/null || true
  git -C "$REPO_ROOT" ls-files --others --exclude-standard -- src 2>/dev/null || true
}

usage() {
  cat <<'USAGE'
用法:
  check-frontend-file-size.sh                     检查本次 git 改动触及的 .ts/.tsx 源码文件（门禁默认）
  check-frontend-file-size.sh --files f1 f2 ..    检查指定文件（测试用）
  check-frontend-file-size.sh --all               扫描全仓，打印报告（不阻断）
  check-frontend-file-size.sh --all --names-only  仅打印超阈值路径（维护白名单用）
环境变量:
  FFS_ROOT       仓库根路径（默认脚本上级目录）
  FFS_ALLOWLIST  白名单路径（默认 scripts/frontend-file-size-allowlist.txt）
USAGE
}

mode=git
names_only=0
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) mode=all; shift;;
    --files) mode=files; shift;;
    --names-only) names_only=1; shift;;
    -h|--help) usage; exit 0;;
    *) files+=("$1"); shift;;
  esac
done

case "$mode" in
  all)
    if [[ "$names_only" == 1 ]]; then
      while IFS= read -r f; do
        rel="$(relpath "$f")"
        is_allowlisted "$rel" && continue
        cls="$(classify "$f")"
        [[ -n "$cls" ]] && printf '%s\n' "$rel"
      done < <(find "$SRC_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
      exit 0
    fi
    echo "扫描全仓前端源码文件 (--all):"
    while IFS= read -r f; do
      report_file "$f"
    done < <(find "$SRC_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
    printf '未豁免超阈值: %s 个（报告模式，不阻断）\n' "$VIOL"
    exit 0
    ;;
  files)
    echo "检查指定文件 (--files):"
    for f in "${files[@]+"${files[@]}"}"; do report_file "$f"; done
    check_allowlist_no_new_files
    ;;
  git)
    echo "检查本次 git 改动触及的前端源码文件:"
    changed="$(collect_changed_frontend_files | sort -u)"
    if [[ -z "$changed" ]]; then
      echo "  (无前端源码文件改动)"
    else
      while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue
        report_file "$REPO_ROOT/$rel"
      done <<< "$changed"
    fi
    check_allowlist_no_new_files
    ;;
esac

if (( VIOL > 0 )); then
  echo
  printf '失败: %s 个违规。拆分指引见 docs/architecture-design/frontend-large-component-splitting-rules.md\n' "$VIOL"
  exit 1
fi
echo "通过: 无违规。"
exit 0
