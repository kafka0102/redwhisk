#!/usr/bin/env bash
# 基于已构建的 .app 手工生成 DMG，绕过 macOS 26 上 hdiutil -srcfolder 的只读回归。
#
# 用法：
#   bash scripts/build-dmg.sh
#   bash scripts/build-dmg.sh /path/to/RedWhisk.app /path/to/RedWhisk_0.0.2_universal.dmg

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误：未找到命令 $1，请先安装。" >&2
    exit 1
  fi
}

for command_name in hdiutil diskutil mount umount rsync node; do
  need_cmd "${command_name}"
done

app_path="${1:-src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app}"
if [[ ! -d "${app_path}" ]]; then
  echo "错误：未找到 .app 产物：${app_path}" >&2
  exit 1
fi

product_name="$(
  node -e "const fs=require('fs'); const conf=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')); process.stdout.write(conf.productName);"
)"
version="$(
  node -e "const fs=require('fs'); const conf=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')); process.stdout.write(conf.version);"
)"

default_output="src-tauri/target/universal-apple-darwin/release/bundle/dmg/${product_name}_${version}_universal.dmg"
output_dmg_input="${2:-${default_output}}"
output_dir_input="$(dirname "${output_dmg_input}")"
mkdir -p "${output_dir_input}"
output_dir="$(cd "${output_dir_input}" && pwd)"
output_dmg="${output_dir}/$(basename "${output_dmg_input}")"

app_name="$(basename "${app_path}")"
volume_name="${product_name}"
size_mb="$(( $(du -sm "${app_path}" | awk '{print $1}') + 64 ))"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/redwhisk-dmg.XXXXXX")"
mount_point="${work_dir}/mount"
temp_dmg="${work_dir}/${product_name}.rw.dmg"
device=""
mounted=0

cleanup() {
  set +e
  if [[ "${mounted}" -eq 1 ]]; then
    umount "${mount_point}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${device}" ]]; then
    hdiutil detach "${device}" >/dev/null 2>&1 || true
  fi
  rm -rf "${work_dir}"
}
trap cleanup EXIT

mkdir -p "${output_dir}" "${mount_point}"
rm -f "${output_dmg}"

echo "==> 创建可写临时 DMG"
hdiutil create -size "${size_mb}m" -fs HFS+ -volname "${volume_name}" "${temp_dmg}" >/dev/null

echo "==> 附加临时 DMG（noMount）"
attach_output="$(diskutil image attach --noMount "${temp_dmg}")"
printf '%s\n' "${attach_output}"

device="$(echo "${attach_output}" | awk '/^\/dev\// { print $1; exit }')"
partition="$(echo "${attach_output}" | awk '/Apple_HFS/ { print $1; exit }')"

if [[ -z "${device}" || -z "${partition}" ]]; then
  echo "错误：无法解析 DMG 设备节点" >&2
  exit 1
fi

echo "==> 手工以读写方式挂载 HFS 分区"
mount -t hfs -o rw "${partition}" "${mount_point}"
mounted=1

echo "==> 复制应用与 Applications 快捷方式"
mkdir -p "${mount_point}/${app_name}"
rsync -a "${app_path}/" "${mount_point}/${app_name}/"
ln -s /Applications "${mount_point}/Applications"
sync

echo "==> 卸载并压缩 DMG"
umount "${mount_point}"
mounted=0
hdiutil detach "${device}" >/dev/null
device=""
hdiutil convert "${temp_dmg}" -format UDZO -imagekey zlib-level=9 -o "${output_dmg}" >/dev/null

echo "✅ DMG 构建完成"
ls -lh "${output_dmg}"
