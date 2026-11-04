#!/usr/bin/env bash
# diff 里新增的 #[tauri::command] 必须有失败路径测试。
# 某个 #[test] 函数体要同时出现该命令名（或 name_ 前缀，如 name_in_data_dir）和 expect_err。
# 只检查新增命令，不追溯存量。成功路径不在本脚本范围内。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-command-failure-tests.sh              检查相对 HEAD 的未提交新增命令
  check-rust-command-failure-tests.sh --from <ref> 检查 <ref>..HEAD 的新增命令
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM_REF="${2:-}"
      shift
      [[ $# -gt 0 ]] && shift
      ;;
    --from=*) FROM_REF="${1#--from=}"; shift;;
    -h|--help) usage; exit 0;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2;;
  esac
done

cd "$REPO_ROOT"
export RUS_FROM_REF="$FROM_REF"
python3 - <<'PY'
import os
import re
import subprocess
import sys

root = os.getcwd()
from_ref = os.environ.get("RUS_FROM_REF", "")
attr_re = re.compile(r"#\[\s*tauri::command\b[^\]]*\]")
fn_re = re.compile(
    r"\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]"
)
test_attr_re = re.compile(r"#\[\s*(?:tokio::)?test\b[^\]]*\]")


def git(*args):
    return subprocess.check_output(["git", *args], text=True, errors="replace")


def parse_diff(diff):
    path = None
    hunk = []

    def flush():
        if path is not None and path.endswith(".rs") and path.startswith("src-tauri/"):
            yield from commands_in_hunk(path, hunk)

    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            yield from flush()
            path = None
            hunk = []
            continue
        if raw.startswith("+++ b/"):
            path = raw[6:]
            continue
        if raw.startswith("@@"):
            yield from flush()
            hunk = []
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            hunk.append(("+", raw[1:]))
        elif raw.startswith("-") and not raw.startswith("---"):
            hunk.append(("-", raw[1:]))
        elif raw.startswith(" "):
            hunk.append((" ", raw[1:]))
    yield from flush()


def commands_in_hunk(_path, hunk):
    for index, (kind, text) in enumerate(hunk):
        if kind != "+" or not attr_re.search(text.strip()):
            continue
        for later_kind, later_text in hunk[index + 1 :]:
            stripped = later_text.strip()
            if later_kind == "-" or stripped == "" or stripped.startswith("#["):
                continue
            match = fn_re.search(stripped)
            if match:
                yield match.group(1)
            break


def added_commands():
    if from_ref:
        diff = git("diff", "-U8", f"{from_ref}...HEAD", "--", "src-tauri")
        return sorted(set(parse_diff(diff)))
    diff = git("diff", "-U8", "HEAD", "--", "src-tauri")
    names = set(parse_diff(diff))
    untracked = git(
        "ls-files", "--others", "--exclude-standard", "--", "src-tauri"
    )
    for rel in untracked.splitlines():
        if not rel.endswith(".rs"):
            continue
        with open(os.path.join(root, rel), encoding="utf-8") as handle:
            names.update(commands_in_hunk(rel, [("+", line.rstrip("\n")) for line in handle]))
    return sorted(names)


def rust_files():
    for dirpath, _dirnames, filenames in os.walk(os.path.join(root, "src-tauri")):
        for filename in filenames:
            if filename.endswith(".rs"):
                yield os.path.join(dirpath, filename)


def test_bodies(text):
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        if not test_attr_re.search(lines[index].strip()):
            index += 1
            continue
        while index < len(lines) and not fn_re.search(lines[index]):
            index += 1
        if index >= len(lines):
            break
        while index < len(lines) and "{" not in lines[index]:
            index += 1
        if index >= len(lines):
            break
        body = []
        depth = 0
        started = False
        while index < len(lines):
            line = lines[index]
            body.append(line)
            depth += line.count("{") - line.count("}")
            if "{" in line:
                started = True
            index += 1
            if started and depth <= 0:
                break
        yield "\n".join(body)


def covers(name, body):
    if "expect_err" not in body:
        return False
    return re.search(
        rf"(?<![\w]){re.escape(name)}(?=_|\W|$)",
        body,
    ) is not None


def failure_test_exists(name):
    for path in rust_files():
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        if name not in text or "expect_err" not in text:
            continue
        for body in test_bodies(text):
            if covers(name, body):
                return True
    return False


commands = added_commands()
if not commands:
    print("没有新增 Tauri command。失败路径检查通过。")
    sys.exit(0)

missing = [name for name in commands if not failure_test_exists(name)]
if missing:
    print("新增 Tauri command 缺少失败路径测试。#[test] 函数体要同时有命令名和 expect_err。")
    for name in missing:
        print(f"  {name}")
    sys.exit(1)

print("新增 Tauri command 的失败路径检查通过。")
PY
