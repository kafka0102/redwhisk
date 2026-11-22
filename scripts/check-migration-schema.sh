#!/usr/bin/env bash
# migration 变更时运行相关 schema 集成测试，避免旧列清单长期漂移。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${MIGRATION_SCHEMA_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CARGO_BIN="${CARGO_BIN:-cargo}"
mode=cached
from_ref=""
files=()

usage() {
  cat <<'USAGE'
用法:
  check-migration-schema.sh                 检查已暂存的 migration 变更
  check-migration-schema.sh --cached        检查已暂存的 migration 变更
  check-migration-schema.sh --from <ref>    检查 <ref>..HEAD 的 migration 变更
  check-migration-schema.sh --files f1 f2   检查指定文件（脚本测试用）

命中 migration 时运行:
  cargo test --offline --lib db::
  cargo test --offline \
    --test local_data --test project --test issue \
    --test agent_session --test settings
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cached)
      mode=cached
      shift
      ;;
    --from)
      mode=from
      from_ref="${2:-}"
      if [[ -z "$from_ref" ]]; then
        echo "缺少 --from 的 ref" >&2
        exit 2
      fi
      shift 2
      ;;
    --from=*)
      mode=from
      from_ref="${1#--from=}"
      shift
      ;;
    --files)
      mode=files
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
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

collect_paths() {
  case "$mode" in
    cached)
      git -C "$REPO_ROOT" diff --cached --name-only --diff-filter=ACMRD
      ;;
    from)
      if ! git -C "$REPO_ROOT" rev-parse --verify -q "${from_ref}^{commit}" >/dev/null; then
        echo "无法解析 --from ${from_ref}" >&2
        exit 2
      fi
      git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMRD "${from_ref}" HEAD
      ;;
    files)
      printf '%s\n' "${files[@]}"
      ;;
  esac
}

is_migration_path() {
  case "$1" in
    src-tauri/migrations/*.sql | \
      src-tauri/src/db/migrations.rs | \
      src-tauri/src/db/migration_list*.rs)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

changed=()
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  if is_migration_path "$path"; then
    changed+=("$path")
  fi
done < <(collect_paths)

if (( ${#changed[@]} == 0 )); then
  echo "  (无 migration 变更，跳过 schema integration tests)"
  exit 0
fi

echo "检测到 migration 变更，运行 schema integration tests:"
printf '  %s\n' "${changed[@]}"
cd "$REPO_ROOT/src-tauri"
"$CARGO_BIN" test --offline --lib db::
"$CARGO_BIN" test --offline \
  --test local_data \
  --test project \
  --test issue \
  --test agent_session \
  --test settings
