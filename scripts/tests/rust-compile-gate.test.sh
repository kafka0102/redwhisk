#!/usr/bin/env bash
# 契约测试：Rust 编译门禁必须编译正式目标、lib 测试和全部集成测试目标。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
gate="${repo_root}/scripts/check-rust-compile.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

sample="${tmp_dir}/repo"
bin_dir="${tmp_dir}/bin"
calls_file="${tmp_dir}/cargo-calls.txt"
mkdir -p "${sample}/src-tauri" "${bin_dir}"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >>"${CARGO_CALLS}"' \
  >"${bin_dir}/cargo"
chmod +x "${bin_dir}/cargo"

PATH="${bin_dir}:${PATH}" \
  CARGO_CALLS="${calls_file}" \
  RRC_ROOT="${sample}" \
  bash "${gate}" >/dev/null

expected="${tmp_dir}/expected.txt"
printf '%s\n' \
  'check --offline --lib --bins' \
  'test --offline --lib --no-run' \
  'check --offline --all-targets' \
  >"${expected}"

if ! diff -u "${expected}" "${calls_file}"; then
  echo "FAIL: Rust 编译门禁调用口径不符合预期" >&2
  exit 1
fi

echo "PASS: Rust 编译门禁覆盖 lib/bin/lib-test/all-targets"
