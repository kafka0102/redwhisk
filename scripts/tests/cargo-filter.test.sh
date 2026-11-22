#!/usr/bin/env bash
# 契约测试：Rust 聚焦测试必须先命中用例，零命中不得被视为红或绿。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner="${repo_root}/scripts/run-cargo-filter.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

fake_cargo="${tmp_dir}/cargo"
calls_file="${tmp_dir}/calls.txt"
cat >"${fake_cargo}" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${CARGO_CALLS}"
case "${CARGO_RESULT:-match}" in
  zero)
    printf 'running 0 tests\n'
    ;;
  one)
    printf 'module::target: test\n'
    ;;
  *)
    printf 'unknown CARGO_RESULT\n' >&2
    exit 2
    ;;
esac
SH
chmod +x "${fake_cargo}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "==> 过滤命中时列出后执行"
output="$(
  CARGO_BIN="${fake_cargo}" \
    CARGO_CALLS="${calls_file}" \
    CARGO_RESULT=one \
    bash "${runner}" --lib module::target 2>&1
)" || fail "命中用例时应通过：${output}"
[[ "$(wc -l <"${calls_file}" | tr -d '[:space:]')" == "2" ]] ||
  fail "应依次执行列清单和真实测试"
grep -Fq -- 'test --lib module::target -- --list' "${calls_file}" ||
  fail "未先执行 --list"
grep -Fq -- 'test --lib module::target' "${calls_file}" ||
  fail "未执行真实测试"

echo "==> 零命中时失败且不执行真实测试"
: >"${calls_file}"
if output="$(
  CARGO_BIN="${fake_cargo}" \
    CARGO_CALLS="${calls_file}" \
    CARGO_RESULT=zero \
    bash "${runner}" --lib missing::filter 2>&1
)"; then
  fail "零命中也应失败：${output}"
fi
[[ "${output}" == *"未命中任何测试"* ]] ||
  fail "应明确报告零命中：${output}"
[[ "$(wc -l <"${calls_file}" | tr -d '[:space:]')" == "1" ]] ||
  fail "零命中时不应执行真实测试"

echo "==> 集成测试目标支持可选过滤"
: >"${calls_file}"
output="$(
  CARGO_BIN="${fake_cargo}" \
    CARGO_CALLS="${calls_file}" \
    CARGO_RESULT=one \
    bash "${runner}" --test dto_parity_export parity_case 2>&1
)" || fail "--test 目标应通过：${output}"
grep -Fq -- 'test --test dto_parity_export parity_case -- --list' "${calls_file}" ||
  fail "未列出集成测试过滤"
grep -Fq -- 'test --test dto_parity_export parity_case' "${calls_file}" ||
  fail "未执行集成测试过滤"

echo "==> 非法用法失败"
if output="$(bash "${runner}" --lib 2>&1)"; then
  fail "缺少过滤参数时应失败：${output}"
fi

echo "PASS: Rust 聚焦测试包装器拒绝零命中"
