#!/usr/bin/env bash
# 契约测试：migration 变更触发 schema integration tests，普通文件不触发。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
gate="${repo_root}/scripts/check-migration-schema.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

sample="${tmp_dir}/repo"
bin_dir="${tmp_dir}/bin"
calls_file="${tmp_dir}/cargo-calls.txt"
mkdir -p "${sample}/src-tauri/src/db" "${bin_dir}"

cat >"${bin_dir}/cargo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${CARGO_CALLS}"
SH
chmod +x "${bin_dir}/cargo"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "==> 普通文件不运行 schema tests"
output="$(
  CARGO_BIN="${bin_dir}/cargo" \
    CARGO_CALLS="${calls_file}" \
    MIGRATION_SCHEMA_ROOT="${sample}" \
    bash "${gate}" --files README.md 2>&1
)" || fail "普通文件应跳过：${output}"
[[ "${output}" == *"无 migration 变更"* ]] ||
  fail "未说明跳过原因：${output}"
[[ ! -s "${calls_file}" ]] ||
  fail "普通文件不应调用 cargo"

echo "==> migration SQL 触发 schema tests"
CARGO_BIN="${bin_dir}/cargo" \
  CARGO_CALLS="${calls_file}" \
  MIGRATION_SCHEMA_ROOT="${sample}" \
  bash "${gate}" --files src-tauri/migrations/0067_project_issue_display_mode.sql >/dev/null
grep -Fq -- \
  'test --offline --lib db::' \
  "${calls_file}" ||
  fail "migration SQL 未触发 lib db schema tests"
grep -Fq -- \
  'test --offline --test local_data --test project --test issue --test agent_session --test settings' \
  "${calls_file}" ||
  fail "migration SQL 未触发完整 integration schema test 集合"

echo "==> migration 注册文件触发 schema tests"
: >"${calls_file}"
CARGO_BIN="${bin_dir}/cargo" \
  CARGO_CALLS="${calls_file}" \
  MIGRATION_SCHEMA_ROOT="${sample}" \
  bash "${gate}" --files src-tauri/src/db/migration_list_tail.rs >/dev/null
[[ -s "${calls_file}" ]] ||
  fail "migration 注册文件未触发 schema tests"

echo "==> pre-commit cached 模式读取暂存 migration"
: >"${calls_file}"
git -C "${sample}" init -q
git -C "${sample}" config user.email "redwhisk@example.test"
git -C "${sample}" config user.name "RedWhisk Test"
printf '%s\n' "ordinary" >"${sample}/README.md"
git -C "${sample}" add README.md
CARGO_BIN="${bin_dir}/cargo" \
  CARGO_CALLS="${calls_file}" \
  MIGRATION_SCHEMA_ROOT="${sample}" \
  bash "${gate}" --cached >/dev/null
[[ ! -s "${calls_file}" ]] ||
  fail "cached 模式不应为普通暂存文件调用 cargo"

mkdir -p "${sample}/src-tauri/migrations"
printf '%s\n' "ALTER TABLE projects ADD COLUMN demo INTEGER;" \
  >"${sample}/src-tauri/migrations/9999_demo.sql"
git -C "${sample}" add src-tauri/migrations/9999_demo.sql
CARGO_BIN="${bin_dir}/cargo" \
  CARGO_CALLS="${calls_file}" \
  MIGRATION_SCHEMA_ROOT="${sample}" \
  bash "${gate}" --cached >/dev/null
[[ -s "${calls_file}" ]] ||
  fail "cached 模式的暂存 migration 未触发 schema tests"

echo "PASS: migration schema gate"
