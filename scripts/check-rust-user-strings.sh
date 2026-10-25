#!/usr/bin/env bash
# 新增的 Rust 源码字符串不得含中文。
# 用户可见错误走英文 code，由前端 i18n 翻译。
# 只检查 src-tauri/src 下本次 diff 的新增行；注释与 src-tauri/tests 不查。
# 存量中文不追溯。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-user-strings.sh              检查相对 HEAD 的未提交新增行
  check-rust-user-strings.sh --from <ref> 检查 <ref>..HEAD 的新增行
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

cjk = re.compile(r"[\u4e00-\u9fff]")
quoted = re.compile(r'"(?:\\.|[^"\\])*"')
root = os.getcwd()
from_ref = os.environ.get("RUS_FROM_REF", "")

def added_lines():
    if from_ref:
        diff = subprocess.check_output(
            ["git", "diff", "-U0", f"{from_ref}...HEAD", "--", "src-tauri/src"],
            text=True,
            errors="replace",
        )
        yield from parse_diff(diff)
        return
    diff = subprocess.check_output(
        ["git", "diff", "-U0", "HEAD", "--", "src-tauri/src"],
        text=True,
        errors="replace",
    )
    yield from parse_diff(diff)
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "src-tauri/src"],
        text=True,
        errors="replace",
    )
    for rel in untracked.splitlines():
        if not rel.endswith(".rs"):
            continue
        with open(os.path.join(root, rel), encoding="utf-8") as handle:
            for number, line in enumerate(handle, start=1):
                yield rel, number, line.rstrip("\n")

def parse_diff(diff):
    path = None
    line_no = 0
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
            continue
        if raw.startswith("@@"):
            match = re.search(r"\+(\d+)", raw)
            line_no = int(match.group(1)) if match else 0
            continue
        if path is None or not path.endswith(".rs"):
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            yield path, line_no, raw[1:]
            line_no += 1
        elif raw.startswith("-"):
            continue
        else:
            line_no += 1

def is_comment(line):
    stripped = line.strip()
    return (
        stripped.startswith("//")
        or stripped.startswith("///")
        or stripped.startswith("//!")
        or stripped.startswith("*")
        or stripped.startswith("/*")
    )

violations = []
for path, number, line in added_lines():
    if is_comment(line):
        continue
    for literal in quoted.findall(line):
        if cjk.search(literal):
            violations.append(f"{path}:{number}: {line.strip()}")
            break

if violations:
    print("新增 Rust 字符串含中文。用户可见错误用英文 code，文案放 locales。")
    for item in violations:
        print(f"  {item}")
    sys.exit(1)

print("Rust 新增字符串检查通过。")
PY
