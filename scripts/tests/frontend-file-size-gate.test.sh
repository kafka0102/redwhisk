#!/usr/bin/env bash
# 契约测试：前端文件大小白名单棘轮。
#
# 直接调用真实脚本，用临时白名单（FFS_ALLOWLIST）+ 真实源码文件断言四种判定：
# 登记值足够 → 通过；文件长过登记值 → 失败；已登记文件回到阈值内 → 要求删除条目；
# 条目缺少可解析行数 → 失败（避免格式漂移让棘轮静默失效）。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

gate="scripts/check-frontend-file-size.sh"
allowlisted_file="src/features/agents/session-workspace/use-session-workspace-cache.ts"
small_file="src/features/agents/message-stream/session-file-links.ts"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

write_allowlist() {
  printf '%s\n' "$1" >"${tmp_dir}/allowlist.txt"
}

run_gate() {
  FFS_ALLOWLIST="${tmp_dir}/allowlist.txt" bash "${gate}" --files "$1" 2>&1
}

listed_lines="$(wc -l <"${allowlisted_file}" | tr -d '[:space:]')"
small_lines="$(wc -l <"${small_file}" | tr -d '[:space:]')"

echo "==> 登记值高于实际行数时通过"
write_allowlist "${allowlisted_file} # $((listed_lines + 5)) lines, registered 2026-10-24"
output="$(run_gate "${allowlisted_file}")" || fail "登记值足够时应通过，实际失败：${output}"
[[ "${output}" == *"[allowlisted]"* ]] || fail "缺少 [allowlisted] 输出：${output}"

echo "==> 实际行数涨过登记值时失败"
write_allowlist "${allowlisted_file} # $((listed_lines - 1)) lines, registered 2026-10-24"
if output="$(run_gate "${allowlisted_file}")"; then
  fail "实际行数超过登记值时应失败：${output}"
fi
[[ "${output}" == *"登记行数"* ]] || fail "缺少棘轮违规提示：${output}"

echo "==> 已回到阈值以内的文件必须删除登记"
write_allowlist "${small_file} # ${small_lines} lines, registered 2026-10-24"
if output="$(run_gate "${small_file}")"; then
  fail "低于阈值的登记应失败：${output}"
fi
[[ "${output}" == *"删除白名单条目"* ]] || fail "缺少删除条目提示：${output}"

echo "==> 登记行数无法解析时失败"
write_allowlist "${allowlisted_file}"
if output="$(run_gate "${allowlisted_file}")"; then
  fail "缺少登记行数时应失败：${output}"
fi
[[ "${output}" == *"缺少可解析的登记行数"* ]] || fail "缺少格式违规提示：${output}"

echo "PASS: 前端文件大小白名单棘轮行为符合预期"
