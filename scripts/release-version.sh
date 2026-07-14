#!/usr/bin/env bash
# 发布指定版本：同步版本号、验证、构建 Mac 包、提交版本改动、创建并推送 tag。
#
# 用法：
#   pnpm release:version 0.0.1
#   bash scripts/release-version.sh 0.0.1

set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  pnpm release:version <version>

示例：
  pnpm release:version 0.0.1

说明：
  - version 使用 x.y.z 或 x.y.z-后缀，例如 0.0.1 或 0.1.0-rc.1
  - 脚本会创建并推送 v<version> tag，以触发 GitHub Actions 发布
  - 运行前要求工作区干净，避免把无关改动混入版本提交
EOF
}

fail() {
  echo "错误：$1" >&2
  exit 1
}

version="${1:-}"
if [[ -z "${version}" || "${version}" == "-h" || "${version}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9_.]+)?$ ]]; then
  fail "版本号格式不合法：${version}，应为 x.y.z 或 x.y.z-后缀"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

export PATH="${HOME}/.nvm/versions/node/v24.4.1/bin:${PATH}"

for command_name in git node pnpm cargo rustup; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fail "未找到命令 ${command_name}"
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "工作区不干净，请先提交或暂存无关改动后再发布"
fi

current_branch="$(git branch --show-current)"
if [[ -z "${current_branch}" ]]; then
  fail "当前处于 detached HEAD，无法安全推送分支"
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  fail "未配置 origin remote"
fi

tag_name="v${version}"
if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null; then
  fail "本地 tag 已存在：${tag_name}"
fi
if git ls-remote --exit-code --tags origin "refs/tags/${tag_name}" >/dev/null 2>&1; then
  fail "远端 tag 已存在：${tag_name}"
fi

echo "==> 同步版本号：${version}"
pnpm bump-version "${version}"

echo "==> 格式化"
pnpm format

echo "==> Lint"
pnpm lint

echo "==> Typecheck"
pnpm typecheck

echo "==> Test"
pnpm test

echo "==> 本地构建 Mac Universal 包"
pnpm build:macos

package_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
tauri_version="$(node -p "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json', 'utf8')).version")"
cargo_version="$(awk -F '"' '/^version = / { print $2; exit }' src-tauri/Cargo.toml)"

if [[ "${package_version}" != "${version}" ]]; then
  fail "package.json 版本不一致：${package_version}"
fi
if [[ "${tauri_version}" != "${version}" ]]; then
  fail "src-tauri/tauri.conf.json 版本不一致：${tauri_version}"
fi
if [[ "${cargo_version}" != "${version}" ]]; then
  fail "src-tauri/Cargo.toml 版本不一致：${cargo_version}"
fi

shopt -s nullglob
app_files=(src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app)
shopt -u nullglob

if (( ${#app_files[@]} == 0 )); then
  fail "未找到 .app 产物"
fi

echo "==> 暂存版本文件"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock

if git diff --cached --quiet; then
  echo "版本文件无变化，跳过版本提交"
else
  git commit -m "chore: 升级版本号至 ${version}"
fi

echo "==> 创建 tag：${tag_name}"
git tag "${tag_name}"

echo "==> 推送当前分支：${current_branch}"
git push origin "${current_branch}"

echo "==> 推送 tag 触发 GitHub Actions：${tag_name}"
git push origin "${tag_name}"

cat <<EOF

发布触发完成。

验证命令：
  gh run list --workflow release.yml --limit 5
  gh release view ${tag_name} --json tagName,isDraft,assets,url

本地产物：
  ${app_files[*]}
EOF
