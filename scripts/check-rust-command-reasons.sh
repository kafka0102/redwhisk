#!/usr/bin/env bash
# diff 里新增的 command reason 字面量必须写入 Tauri 契约。
# 只看 src-tauri/src 的新增行：with_reason("...")、("reason", "...")、以及 => "reason"。
# reason 须是含大写字母的 camelCase。存量 reason 不追溯。测试文件里的断言不查。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-command-reasons.sh              检查相对 HEAD 的未提交新增 reason
  check-rust-command-reasons.sh --from <ref> 检查 <ref>..HEAD 的新增 reason
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
contract_path = os.path.join(root, "docs/architecture-design/tauri-contract.md")
call_re = re.compile(r'with_reason\(\s*"([A-Za-z_][A-Za-z0-9_]*)"')
tuple_re = re.compile(r'\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*,\s*"')
arm_re = re.compile(r'=>\s*"([A-Za-z_][A-Za-z0-9_]*)"')


def git(*args):
    return subprocess.check_output(["git", *args], text=True, errors="replace")


def is_source(path):
    if path is None or not path.endswith(".rs"):
        return False
    if not path.startswith("src-tauri/src/"):
        return False
    name = os.path.basename(path)
    if name.endswith("_test.rs") or name.endswith("_tests.rs"):
        return False
    return "/tests/" not in path


def code_only(text):
    return text.split("//", 1)[0]


def is_reason(token):
    return bool(re.fullmatch(r"[a-z][A-Za-z0-9]*", token) and re.search(r"[A-Z]", token))


def literals(text):
    line = code_only(text)
    found = []
    for pattern in (call_re, tuple_re, arm_re):
        for match in pattern.finditer(line):
            token = match.group(1)
            if is_reason(token):
                found.append(token)
    return found


def parse_diff(diff):
    path = None
    added = set()
    removed = set()
    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            path = None
            continue
        if raw.startswith("+++ b/"):
            path = raw[6:]
            continue
        if not is_source(path):
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            added.update(literals(raw[1:]))
        elif raw.startswith("-") and not raw.startswith("---"):
            removed.update(literals(raw[1:]))
    return added - removed


def untracked_reasons():
    found = set()
    listing = git("ls-files", "--others", "--exclude-standard", "--", "src-tauri/src")
    for rel in listing.splitlines():
        if not is_source(rel):
            continue
        with open(os.path.join(root, rel), encoding="utf-8") as handle:
            for line in handle:
                found.update(literals(line.rstrip("\n")))
    return found


def added_reasons():
    if from_ref:
        diff = git("diff", "-U0", f"{from_ref}...HEAD", "--", "src-tauri/src")
        return parse_diff(diff)
    diff = git("diff", "-U0", "HEAD", "--", "src-tauri/src")
    return parse_diff(diff) | untracked_reasons()


def contract_has(token, contract):
    return re.search(rf"(?<![A-Za-z0-9_]){re.escape(token)}(?![A-Za-z0-9_])", contract) is not None


reasons = sorted(added_reasons())
if not reasons:
    print("没有新增 command reason。契约检查通过。")
    sys.exit(0)

with open(contract_path, encoding="utf-8") as handle:
    contract = handle.read()

missing = [token for token in reasons if not contract_has(token, contract)]
if missing:
    print("新增 command reason 没有写入 docs/architecture-design/tauri-contract.md。")
    for token in missing:
        print(f"  {token}")
    sys.exit(1)

print("新增 command reason 的契约检查通过。")
PY
