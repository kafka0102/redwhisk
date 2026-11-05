#!/usr/bin/env bash
# diff 里新增的 app.emit / app_handle.emit 必须位于函数名以 emit_ 开头的函数中。
# 只检查新增调用，不追溯存量。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-event-emit.sh              检查相对 HEAD 的未提交新增 emit
  check-rust-event-emit.sh --from <ref> 检查 <ref>..HEAD 的新增 emit
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
emit_re = re.compile(r"\b(?:app|app_handle)\.emit\s*\(")
fn_re = re.compile(r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]")


def git(*args):
    return subprocess.check_output(["git", *args], text=True, errors="replace")


def added_lines():
    if from_ref:
        diff = git("diff", "-U0", f"{from_ref}...HEAD", "--", "src-tauri/src")
    else:
        diff = git("diff", "-U0", "HEAD", "--", "src-tauri/src")
    path = None
    new_line = 0
    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            path = None
            continue
        if raw.startswith("+++ b/"):
            path = raw[6:]
            continue
        if raw.startswith("@@"):
            match = re.search(r"\+(\d+)", raw)
            new_line = int(match.group(1)) if match else 0
            continue
        if path is None or not path.endswith(".rs"):
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            yield path, new_line, raw[1:]
            new_line += 1
        elif raw.startswith("-") and not raw.startswith("---"):
            continue
        else:
            new_line += 1


def read_new_file(rel):
    full = os.path.join(root, rel)
    if os.path.exists(full) and not from_ref:
        with open(full, encoding="utf-8") as handle:
            return handle.read().splitlines()
    try:
        text = git("show", f"HEAD:{rel}")
    except subprocess.CalledProcessError:
        return []
    return text.splitlines()


def enclosing_function(lines, line_number):
    for index in range(min(line_number, len(lines)) - 1, -1, -1):
        match = fn_re.search(lines[index])
        if match:
            return match.group(1)
    return ""


failures = []
seen = set()
file_cache = {}
for rel, line_number, text in added_lines():
    if not emit_re.search(text) or text.strip().startswith("//"):
        continue
    key = (rel, line_number, text.strip())
    if key in seen:
        continue
    seen.add(key)
    if rel not in file_cache:
        file_cache[rel] = read_new_file(rel)
    name = enclosing_function(file_cache[rel], line_number)
    if not name.startswith("emit_"):
        failures.append(f"{rel}:{line_number} {name or '<unknown>'} 直接调用 emit")

if from_ref == "":
    untracked = git("ls-files", "--others", "--exclude-standard", "--", "src-tauri/src")
    for rel in untracked.splitlines():
        if not rel.endswith(".rs"):
            continue
        with open(os.path.join(root, rel), encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        for index, text in enumerate(lines, start=1):
            if not emit_re.search(text) or text.strip().startswith("//"):
                continue
            name = enclosing_function(lines, index)
            if not name.startswith("emit_"):
                failures.append(f"{rel}:{index} {name or '<unknown>'} 直接调用 emit")

if failures:
    print("新增 Tauri emit 必须位于 emit_* 函数中：", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}", file=sys.stderr)
    sys.exit(1)
PY
