#!/usr/bin/env bash
# 前端门禁单一入口（AGENTS.md §5 第 1–5、8 项）。
#
# 按 AGENTS.md 规定的顺序执行并逐步打印，任一步失败即停止：
#   1. pnpm format（随后打印 git status --short，格式化带出的文件纳入本次提交）
#   2. pnpm lint
#   3. pnpm typecheck
#   4. pnpm test（全量；过滤运行只用于定位）
#   5. pnpm build（仅 --with-build；依赖 / 构建配置 / 静态资源 / 打包代码变更时）
#   8. bash scripts/check-frontend-file-size.sh（白名单棘轮）
#
# 用法:
#   bash scripts/check-frontend-gates.sh                 常规前端改动
#   bash scripts/check-frontend-gates.sh --with-build    改依赖或构建配置时
#   bash scripts/check-frontend-gates.sh --from <ref>    已提交后用 <ref>..HEAD 口径复查文件大小
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

with_build=0
from_ref=""

usage() {
  cat <<'USAGE'
用法:
  check-frontend-gates.sh                 跑 format / status / lint / typecheck / test / 文件大小门禁
  check-frontend-gates.sh --with-build    追加 pnpm build（依赖或构建配置变更时必跑）
  check-frontend-gates.sh --from <ref>    文件大小门禁改用 <ref>..HEAD 口径（提交后复查用）
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-build) with_build=1; shift;;
    --from)
      from_ref="${2:-}"
      shift
      [[ $# -gt 0 ]] && shift
      ;;
    --from=*) from_ref="${1#--from=}"; shift;;
    -h|--help) usage; exit 0;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2;;
  esac
done

step() {
  printf '\n==> %s\n' "$*"
}

step "第 1 项：pnpm format"
pnpm format

step "第 1 项复查：git status --short（带出的文件按 AGENTS.md §8 处理）"
git status --short

step "第 2 项：pnpm lint"
pnpm lint

step "第 3 项：pnpm typecheck"
pnpm typecheck

step "第 4 项：pnpm test（全量）"
pnpm test

if (( with_build )); then
  step "第 5 项：pnpm build"
  pnpm build
else
  step "第 5 项：pnpm build（未加 --with-build，跳过；依赖 / 构建配置 / 静态资源 / 打包代码变更时必须加）"
fi

step "第 8 项：前端文件大小门禁"
if [[ -n "${from_ref}" ]]; then
  bash "${SCRIPT_DIR}/check-frontend-file-size.sh" --from "${from_ref}"
else
  bash "${SCRIPT_DIR}/check-frontend-file-size.sh"
fi

step "前端门禁通过"
