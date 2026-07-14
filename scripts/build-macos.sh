#!/usr/bin/env bash
# 本地构建 Universal Mac 可执行文件（同时含 Intel 与 Apple Silicon）
# 产出：src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app
#
# 用法：
#   pnpm build:macos        # 推荐
#   bash scripts/build-macos.sh

set -euo pipefail

# 1. 进入仓库根（脚本可从任意目录调用）
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

# 2. 前置检查：rustup / pnpm / cargo 必须可用
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误：未找到命令 $1，请先安装。" >&2
    exit 1
  fi
}
need_cmd rustup
need_cmd pnpm
need_cmd cargo

# 3. 安装双架构编译 target（rustup 已安装会自动跳过）
echo "==> 安装 aarch64-apple-darwin / x86_64-apple-darwin target"
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# 4. 安装前端依赖（保持与 lockfile 一致）
echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# 5. 构建 Universal .app：Tauri 内部会编译两份并 lipo 合并
echo "==> pnpm tauri build --target universal-apple-darwin --bundles app"
pnpm tauri build --target universal-apple-darwin --bundles app

# 6. 打印产物路径
bundle_dir="src-tauri/target/universal-apple-darwin/release/bundle"
echo
echo "✅ 构建完成"
echo "产物目录：${bundle_dir}"
if [[ -d "${bundle_dir}/macos" ]]; then
  echo "APP 包："
  ls -lh "${bundle_dir}/macos"
fi
