#!/usr/bin/env bash
# 契约测试：Release CI 与 release:version 必须同时覆盖 Universal DMG 与 .app.zip。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

workflow=".github/workflows/release.yml"
release_script="scripts/release-version.sh"

[[ -f "${workflow}" ]] || fail "缺少 ${workflow}"
[[ -f "${release_script}" ]] || fail "缺少 ${release_script}"

echo "==> 检查 workflow 含 DMG 与 app.zip 路径约定"
for needle in \
  'src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg' \
  'src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app.zip' \
  'pnpm build:macos' \
  '校验 DMG 产物'
do
  if ! grep -Fq "${needle}" "${workflow}"; then
    fail "workflow 缺少约定：${needle}"
  fi
done

# softprops files 与 upload-artifact path 都应出现 DMG（出现次数 ≥ 2）
dmg_hits="$(grep -Fc 'bundle/dmg/*.dmg' "${workflow}" || true)"
if (( dmg_hits < 2 )); then
  fail "workflow 中 dmg 路径应同时出现在 artifact 与 Release files（当前 ${dmg_hits} 次）"
fi

echo "==> 检查 release-version.sh 对缺失 DMG 失败"
if ! grep -Fq 'fail "未找到 .dmg 产物"' "${release_script}"; then
  fail "release-version.sh 未对缺失 .dmg 显式失败"
fi
if ! grep -Fq 'bundle/dmg/*.dmg' "${release_script}"; then
  fail "release-version.sh 未扫描 dmg 产物路径"
fi

echo "==> 模拟产物校验逻辑（缺失 DMG 应失败，存在应通过）"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/redwhisk-release-dmg-test.XXXXXX")"
trap 'rm -rf "${work_dir}"' EXIT

check_artifacts() {
  local root="$1"
  (
    cd "${root}"
    shopt -s nullglob
    app_files=(src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app)
    dmg_files=(src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg)
    shopt -u nullglob
    if (( ${#app_files[@]} == 0 )); then
      echo "未找到 .app 产物" >&2
      return 1
    fi
    if (( ${#dmg_files[@]} == 0 )); then
      echo "未找到 .dmg 产物" >&2
      return 1
    fi
    return 0
  )
}

mkdir -p "${work_dir}/src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app/Contents"
if check_artifacts "${work_dir}"; then
  fail "仅有 .app 时校验应失败"
fi

mkdir -p "${work_dir}/src-tauri/target/universal-apple-darwin/release/bundle/dmg"
: > "${work_dir}/src-tauri/target/universal-apple-darwin/release/bundle/dmg/RedWhisk_0.0.0_universal.dmg"
if ! check_artifacts "${work_dir}"; then
  fail "同时有 .app 与 .dmg 时校验应通过"
fi

echo "✅ release DMG 产物契约验收通过"
