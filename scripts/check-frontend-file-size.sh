#!/usr/bin/env bash
# 前端单文件大小门禁脚本
# 规范: docs/architecture-design/frontend-large-component-splitting-rules.md
# 阈值（沿用 ADR 0016，与后端对称）: 常规 500 / 编排容器 800 / 硬上限 1000
# 白名单是棘轮：条目里登记的行数是上限，文件只能缩小；涨过登记值即违规。
# 已回到阈值以内的文件必须从白名单删除，否则同样违规。
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

# 打印白名单条目（原文，仅去首尾空白、去 \r），跳过注释与空行。
# 保留 `#` 之后的部分，供解析登记行数使用。
allowlist_entries() {
  [[ -f "$ALLOWLIST" ]] || return 0
  awk '{
    sub(/\r$/,"");
    line=$0;
    gsub(/^[ \t]+|[ \t]+$/,"",line);
    if (line=="" || line ~ /^#/) next;
    print line
  }' "$ALLOWLIST"
}

# 打印白名单相对路径（去掉注释与首尾空白），忽略空行
allowlist_paths() {
  local line path_part
  while IFS= read -r line; do
    path_part="${line%%#*}"
    printf '%s\n' "$(printf '%s' "$path_part" | tr -d '[:space:]')"
  done < <(allowlist_entries)
}

# 读取某条目登记的基线行数（`<path> # <N> lines, ...` 里的 N）；
# 解析不出时非零退出，避免格式漂移让棘轮静默失效。
allowlist_registered_count() {
  local rel="$1" line path_part count
  while IFS= read -r line; do
    path_part="$(printf '%s' "${line%%#*}" | tr -d '[:space:]')"
    [[ "$path_part" == "$rel" ]] || continue
    count="$(printf '%s' "$line" | sed -n 's/.*#[[:space:]]*\([0-9][0-9]*\)[[:space:]]*lines.*/\1/p')"
    [[ -n "$count" ]] || return 1
    printf '%s\n' "$count"
    return 0
  done < <(allowlist_entries)
  return 1
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
  local f="$1" rel lines cls registered thr
  rel="$(relpath "$f")"
  is_counted_source "$rel" || return 0
  [[ -f "$f" ]] || return 0
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  if is_allowlisted "$rel"; then
    # 白名单是棘轮：登记行数只允许下调。已登记文件长过登记值 → 违规，
    # 迫使「本次增长」显式出现在 diff 里（调登记值或先拆分），而不是静默漂移。
    if ! registered="$(allowlist_registered_count "$rel")"; then
      printf '  [VIOLATION] %s: 白名单条目缺少可解析的登记行数（格式应为 `<path> # <N> lines, ...`）\n' "$rel"
      VIOL=$((VIOL+1))
      return 0
    fi
    if (( lines > registered )); then
      printf '  [VIOLATION] %s: %s lines > 登记行数 %s（白名单只允许缩小；先拆分或先下调登记值）\n' \
        "$rel" "$lines" "$registered"
      VIOL=$((VIOL+1))
      return 0
    fi
    thr="$(threshold_for "$rel")"
    if (( lines <= thr )); then
      printf '  [VIOLATION] %s: %s lines 已回到阈值 %s 以内，请删除白名单条目\n' "$rel" "$lines" "$thr"
      VIOL=$((VIOL+1))
      return 0
    fi
    printf '  [allowlisted] %s (%s lines ≤ 登记 %s，存量待拆分)\n' "$rel" "$lines" "$registered"
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
  if [[ -n "$FROM_REF" ]]; then
    git -C "$REPO_ROOT" diff --name-only "$FROM_REF" HEAD -- src 2>/dev/null || true
    return
  fi
  # pathspec 用目录前缀 src；非源码（测试文件、src/test/）由 is_counted_source 过滤。
  git -C "$REPO_ROOT" diff --name-only HEAD -- src 2>/dev/null || true
  git -C "$REPO_ROOT" ls-files --others --exclude-standard -- src 2>/dev/null || true
}

# 空转告警：git 模式只看未提交改动，提交后再跑将看不到任何文件而「通过」。
# 若 HEAD 提交本身触及了受管源码，显式说明这次运行等于没检查，避免把空转当成门禁通过。
warn_gate_noop() {
  echo "  (无待检查的前端源码文件改动)"
  # 仅默认模式（未指定 --from）下判断是否空转：HEAD 提交自身触及受管源码、
  # 而工作区干净，说明门禁很可能是在 commit 之后才跑的。
  [[ -z "$FROM_REF" ]] || return 0
  local base rel counted=0
  base="$(git -C "$REPO_ROOT" rev-parse --verify -q HEAD~1 2>/dev/null || true)"
  [[ -n "$base" ]] || return 0
  # 只统计门禁真正管的文件，测试文件与 src/test/ 不计入。
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    is_counted_source "$rel" && counted=$((counted + 1))
  done < <(git -C "$REPO_ROOT" diff --name-only "$base" HEAD -- src 2>/dev/null || true)
  (( counted > 0 )) || return 0
  echo
  printf '  [告警] HEAD 提交触及 %s 个前端源码文件，但工作区无未提交改动：本次运行属于空转，未检查任何文件。\n' "$counted"
  echo "         门禁须在 git commit 之前运行；改动已提交时用 --from 指定范围复查，例如："
  echo "         bash scripts/check-frontend-file-size.sh --from HEAD~1"
}

usage() {
  cat <<'USAGE'
用法:
  check-frontend-file-size.sh                     检查本次 git 改动触及的 .ts/.tsx 源码文件（门禁默认）
  check-frontend-file-size.sh --from <ref>        检查 <ref>..HEAD 之间改动触及的 .ts/.tsx 源码文件
  check-frontend-file-size.sh --files f1 f2 ..    检查指定文件（测试用）
  check-frontend-file-size.sh --all               扫描全仓，打印报告（不阻断）
  check-frontend-file-size.sh --all --names-only  仅打印超阈值路径（维护白名单用）
白名单棘轮:
  条目格式 `<path> # <N> lines, registered <date>`；实际行数 > N 视为违规。
  文件回到阈值以内时须删除条目；维护时用 `--all` 复核登记行数。
环境变量:
  FFS_ROOT       仓库根路径（默认脚本上级目录）
  FFS_ALLOWLIST  白名单路径（默认 scripts/frontend-file-size-allowlist.txt）
USAGE
}

mode=git
names_only=0
FROM_REF=""
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) mode=all; shift;;
    --files) mode=files; shift;;
    --from)
      FROM_REF="${2:-}"
      shift
      [[ $# -gt 0 ]] && shift
      ;;
    --from=*) FROM_REF="${1#--from=}"; shift;;
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
    if [[ -n "$FROM_REF" ]]; then
      echo "检查 $FROM_REF..HEAD 触及的前端源码文件:"
    else
      echo "检查本次 git 改动触及的前端源码文件:"
    fi
    changed="$(collect_changed_frontend_files | sort -u)"
    if [[ -z "$changed" ]]; then
      warn_gate_noop
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
