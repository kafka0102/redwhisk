#!/usr/bin/env bash
# 契约测试：reason 门禁必须覆盖间接返回 reason 的本地 helper。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
locale_gate="${repo_root}/scripts/check-rust-reason-locales.sh"
contract_gate="${repo_root}/scripts/check-rust-command-reasons.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

sample="${tmp_dir}/repo"
source_file="${sample}/src-tauri/src/features/example/reason.rs"
locale_dir="${sample}/src/shared/i18n/locales"
contract_file="${sample}/docs/architecture-design/tauri-contract.md"
mkdir -p "$(dirname "${source_file}")" "${locale_dir}" "$(dirname "${contract_file}")"

cat >"${source_file}" <<'RS'
pub fn validation_error(reason: &'static str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectValidationFailed, "invalid")
        .with_reason(reason)
}

pub fn update() {
    let _ = validation_error("existingReason");
}
RS
printf '# Contract\n\nexistingReason\n' >"${contract_file}"
cat >"${locale_dir}/zh.json" <<'JSON'
{"errors":{"PROJECT_VALIDATION_FAILED":{"existingReason":"已有原因"}}}
JSON
cat >"${locale_dir}/en.json" <<'JSON'
{"errors":{"PROJECT_VALIDATION_FAILED":{"existingReason":"Existing reason"}}}
JSON

git -C "${sample}" init -q -b main
git -C "${sample}" config user.email test@example.com
git -C "${sample}" config user.name Test
git -C "${sample}" add .
git -C "${sample}" commit -qm baseline

printf '%s\n' \
  '' \
  'pub fn changed() {' \
  '    let _ = validation_error("indirectReason");' \
  '}' \
  >>"${source_file}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "==> 间接 helper reason 缺契约时失败"
if output="$(RUS_ROOT="${sample}" bash "${contract_gate}" 2>&1)"; then
  fail "间接 helper reason 缺契约时应失败：${output}"
fi
[[ "${output}" == *"indirectReason"* ]] ||
  fail "契约门禁应点名间接 reason：${output}"

echo "==> 间接 helper reason 缺 locale 时失败"
if output="$(RRL_ROOT="${sample}" bash "${locale_gate}" 2>&1)"; then
  fail "间接 helper reason 缺 locale 时应失败：${output}"
fi
[[ "${output}" == *"indirectReason"* ]] ||
  fail "locale 门禁应点名间接 reason：${output}"
[[ "${output}" == *"PROJECT_VALIDATION_FAILED"* ]] ||
  fail "locale 门禁应解析 helper 的错误码：${output}"

echo "==> 补齐契约与 locale 后通过"
printf '%s\n' 'indirectReason' >>"${contract_file}"
cat >"${locale_dir}/zh.json" <<'JSON'
{"errors":{"PROJECT_VALIDATION_FAILED":{"existingReason":"已有原因","indirectReason":"间接原因"}}}
JSON
cat >"${locale_dir}/en.json" <<'JSON'
{"errors":{"PROJECT_VALIDATION_FAILED":{"existingReason":"Existing reason","indirectReason":"Indirect reason"}}}
JSON

RUS_ROOT="${sample}" bash "${contract_gate}" >/dev/null
RRL_ROOT="${sample}" bash "${locale_gate}" >/dev/null

echo "==> 未跟踪 Rust 文件的间接 helper reason 同样受检查"
cat >"${sample}/src-tauri/src/features/example/untracked.rs" <<'RS'
pub fn validation_error(reason: &'static str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectValidationFailed, "invalid")
        .with_reason(reason)
}

pub fn changed() {
    let _ = validation_error("untrackedReason");
}
RS
if output="$(RUS_ROOT="${sample}" bash "${contract_gate}" 2>&1)"; then
  fail "未跟踪文件的 reason 缺契约时应失败：${output}"
fi
[[ "${output}" == *"untrackedReason"* ]] ||
  fail "契约门禁应检查未跟踪文件：${output}"
if output="$(RRL_ROOT="${sample}" bash "${locale_gate}" 2>&1)"; then
  fail "未跟踪文件的 reason 缺 locale 时应失败：${output}"
fi
[[ "${output}" == *"untrackedReason"* ]] ||
  fail "locale 门禁应检查未跟踪文件：${output}"

echo "PASS: 间接 reason helper 同时受契约与 locale 门禁约束"
