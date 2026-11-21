#!/usr/bin/env bash
# 契约测试：跨 feature import 棘轮只允许存量依赖，并拒绝过期的 allowlist。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
gate="${repo_root}/scripts/check-frontend-feature-boundaries.mjs"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

sample="${tmp_dir}/repo"
allowlist="${tmp_dir}/allowlist.txt"
mkdir -p "${sample}/src/features/agents" "${sample}/src/features/settings"
printf 'export const settingsTarget = true;\n' >"${sample}/src/features/settings/target.ts"
printf '%s\n' \
  'import { settingsTarget } from "../settings/target";' \
  'import { settingsTarget as sameTarget } from "../settings/target";' \
  'export const allowed = settingsTarget || sameTarget;' \
  >"${sample}/src/features/agents/allowed.ts"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

run_gate() {
  FEATURE_BOUNDARY_ROOT="${sample}" \
    FEATURE_BOUNDARY_ALLOWLIST="${allowlist}" \
    node "${gate}" "$@" 2>&1
}

echo "==> 生成存量基线后通过"
run_gate --update >/dev/null
output="$(run_gate)" || fail "存量依赖应通过：${output}"
[[ "${output}" == *"1 条存量依赖，0 条新增"* ]] ||
  fail "同一 file→specifier 的多个 import 应去重为 1 条：${output}"

echo "==> 新增跨 feature import 失败"
printf 'import { settingsTarget } from "../settings/target";\n' \
  >"${sample}/src/features/agents/new-edge.ts"
if output="$(run_gate)"; then
  fail "新增依赖应失败：${output}"
fi
[[ "${output}" == *"new-edge.ts -> ../settings/target"* ]] ||
  fail "应点名新增依赖：${output}"

echo "==> allowlist 中的依赖消失后失败"
printf 'export const local = true;\n' >"${sample}/src/features/agents/allowed.ts"
if output="$(run_gate)"; then
  fail "过期 allowlist 应失败：${output}"
fi
[[ "${output}" == *"allowlist 中存在已消失的依赖"* ]] ||
  fail "应提示收紧 allowlist：${output}"

echo "==> 同 feature 与 shared import 不误报"
rm -f "${sample}/src/features/agents/new-edge.ts"
printf 'import { shared } from "../../shared/shared";\n' \
  >"${sample}/src/features/agents/allowed.ts"
printf 'export const local = shared;\n' >>"${sample}/src/features/agents/allowed.ts"
mkdir -p "${sample}/src/features/agents/sub"
printf 'import { local } from "../allowed";\n' \
  >"${sample}/src/features/agents/sub/same-feature.ts"
mkdir -p "${sample}/src/shared"
printf 'export const shared = true;\n' >"${sample}/src/shared/shared.ts"
run_gate --update >/dev/null
output="$(run_gate)" || fail "无跨 feature import 时应通过：${output}"
[[ "${output}" == *"0 条存量依赖，0 条新增"* ]] ||
  fail "同 feature/shared import 不应计入：${output}"

echo "PASS: 跨 feature import 棘轮行为符合预期"
