#!/usr/bin/env bash
# 验证 scripts/build-dmg.sh：给定最小假 .app，产出可挂载 DMG，
# 挂载后可见 .app 与 Applications 符号链接。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误：未找到命令 $1" >&2
    exit 1
  fi
}

for command_name in hdiutil diskutil mount umount rsync; do
  need_cmd "${command_name}"
done

if [[ ! -f "scripts/build-dmg.sh" ]]; then
  echo "FAIL: 缺少 scripts/build-dmg.sh" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/redwhisk-build-dmg-test.XXXXXX")"
fake_app="${work_dir}/RedWhisk.app"
output_dmg="${work_dir}/RedWhisk_test_universal.dmg"
mount_point="${work_dir}/mount"
device=""
mounted=0

cleanup() {
  set +e
  if [[ "${mounted}" -eq 1 ]]; then
    umount "${mount_point}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${device}" ]]; then
    hdiutil detach "${device}" -force >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "${fake_app}/Contents/MacOS" "${mount_point}"
printf '#!/bin/sh\necho ok\n' > "${fake_app}/Contents/MacOS/RedWhisk"
chmod +x "${fake_app}/Contents/MacOS/RedWhisk"
cat > "${fake_app}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>RedWhisk</string>
  <key>CFBundleIdentifier</key>
  <string>work.redwhisk.test</string>
  <key>CFBundleName</key>
  <string>RedWhisk</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
PLIST

echo "==> 运行 build-dmg.sh（假 .app）"
bash scripts/build-dmg.sh "${fake_app}" "${output_dmg}"

if [[ ! -f "${output_dmg}" ]]; then
  echo "FAIL: 未生成 DMG：${output_dmg}" >&2
  exit 1
fi

# 与 build-dmg 相同路径：diskutil attach --noMount + 手工 mount，
# 避免本机环境上 hdiutil attach 挂载挂起。
echo "==> 挂载 DMG 并检查结构"
attach_output="$(diskutil image attach --noMount "${output_dmg}")"
printf '%s\n' "${attach_output}"

device="$(echo "${attach_output}" | awk '/^\/dev\// { print $1; exit }')"
partition="$(echo "${attach_output}" | awk '/Apple_HFS/ { print $1; exit }')"

if [[ -z "${device}" || -z "${partition}" ]]; then
  echo "FAIL: 无法解析 DMG 设备节点" >&2
  echo "${attach_output}" >&2
  exit 1
fi

mount -t hfs -o ro "${partition}" "${mount_point}"
mounted=1

if [[ ! -d "${mount_point}/RedWhisk.app/Contents" ]]; then
  echo "FAIL: 挂载卷内缺少正确的 RedWhisk.app 布局" >&2
  ls -la "${mount_point}" >&2 || true
  ls -laR "${mount_point}/RedWhisk.app" >&2 || true
  exit 1
fi

if [[ ! -f "${mount_point}/RedWhisk.app/Contents/MacOS/RedWhisk" ]]; then
  echo "FAIL: 挂载卷内 .app 可执行文件缺失" >&2
  exit 1
fi

if [[ ! -L "${mount_point}/Applications" ]]; then
  echo "FAIL: 挂载卷内缺少 Applications 符号链接" >&2
  ls -la "${mount_point}" >&2 || true
  exit 1
fi

link_target="$(readlink "${mount_point}/Applications")"
if [[ "${link_target}" != "/Applications" ]]; then
  echo "FAIL: Applications 链接目标应为 /Applications，实际为 ${link_target}" >&2
  exit 1
fi

echo "✅ build-dmg 假 .app 验收通过：${output_dmg}"
