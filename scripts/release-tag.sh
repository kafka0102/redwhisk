#!/usr/bin/env bash
# 轻量发版：同步版本号、提交、创建并推送 tag（不跑 format/lint/typecheck/test/build）。
# CI 在收到 v*.*.* tag 后负责构建与 draft Release。
#
# 用法：
#   pnpm release:tag 0.0.9
#   bash scripts/release-tag.sh 0.0.9

set -euo pipefail

usage() {
  cat <<'USAGE'
用法：
  pnpm release:tag <version>

示例：
  pnpm release:tag 0.0.9

说明：
  - version 使用 x.y.z 或 x.y.z-后缀，例如 0.0.9 或 0.1.0-rc.1
  - 只做：bump-version → 提交版本文件 → 创建 v<version> tag → push 分支与 tag
  - 不跑本地 format / lint / typecheck / test / build；构建由 GitHub Actions 完成
  - 运行前要求工作区干净，避免把无关改动混入版本提交
USAGE
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

for command_name in git node pnpm cargo; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fail "未找到命令 ${command_name}"
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "工作区不干净，请先提交或暂存无关改动后再发版"
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

cat <<DONE

轻量发版完成（未本地构建）。

验证命令：
  gh run list --workflow release.yml --limit 5
  gh release view ${tag_name} --json tagName,isDraft,assets,url

说明：
  - CI 会创建 draft Release；需人工 Publish 后用户端才检测为可用更新
  - 本路径不产出本地 .app / DMG
DONE
