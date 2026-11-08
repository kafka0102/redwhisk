#!/usr/bin/env bash
# 新增 command reason 必须在对应错误码的中英文 locale 里有文案。
# with_reason / coded_error 用同一函数里的 CommandErrorCode，键是 errors.<CODE>.<reason>。
# features/issue/completion 里作为失败原因返回的裸 reason 用 errors.ISSUE_VALIDATION_FAILED。
# 只查 src-tauri/src 的新增字面量。存量 reason 不追溯。测试文件不查。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RRL_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-reason-locales.sh              检查相对 HEAD 的未提交新增 reason 文案
  check-rust-reason-locales.sh --from <ref> 检查 <ref>..HEAD 的新增 reason 文案
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
export RRL_FROM_REF="$FROM_REF"
python3 - <<'PY'
import json
import os
import re
import subprocess
import sys

root = os.getcwd()
from_ref = os.environ.get("RRL_FROM_REF", "")
reason_re = re.compile(r"[a-z][A-Za-z0-9]*")
code_re = re.compile(r"CommandErrorCode::(\w+)")
fn_re = re.compile(
    r"(?m)^[ \t]*(?:#\[test\]\s*)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)"
)
with_reason_re = re.compile(r'with_reason\(\s*"([a-z][A-Za-z0-9]*)"')
coded_error_re = re.compile(r"\bcoded_error\s*\(")
quoted_re = re.compile(r'"([a-z][A-Za-z0-9]*)"')


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


def is_reason(token):
    return bool(re.fullmatch(r"[a-z][A-Za-z0-9]*", token) and re.search(r"[A-Z]", token))


def screaming(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


def read_text(path):
    with open(os.path.join(root, path), encoding="utf-8") as handle:
        return handle.read()


def functions(text):
    matches = list(fn_re.finditer(text))
    spans = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        spans.append((match.group(1), text[match.start() : end], match.start()))
    return spans


def helper_code(text, name):
    for fn_name, body, _start in functions(text):
        if fn_name != name:
            continue
        codes = list(dict.fromkeys(code_re.findall(body)))
        if len(codes) == 1:
            return codes[0]
    return None


def line_starts(text):
    starts = [0]
    for match in re.finditer(r"\n", text):
        starts.append(match.end())
    return starts


def window_at(text, line_no, before=12, after=3):
    starts = line_starts(text)
    if line_no < 1 or line_no > len(starts):
        return ""
    first = max(1, line_no - before)
    last = min(len(starts), line_no + after)
    return text[starts[first - 1] : text.find("\n", starts[last - 1])]


def requirements_in_window(path, window, file_text):
    found = []
    if not is_source(path):
        return found
    completion = path.startswith("src-tauri/src/features/issue/completion/")
    commandish = "with_reason" in window or "coded_error" in window
    for match in with_reason_re.finditer(window):
        token = match.group(1)
        if not is_reason(token):
            continue
        codes = code_re.findall(window[: match.start()])
        found.append((screaming(codes[-1]) if codes else None, token, path))
    for match in coded_error_re.finditer(window):
        rest = window[match.end() : match.end() + 240]
        quoted = quoted_re.search(rest)
        if quoted is None or not is_reason(quoted.group(1)):
            continue
        helper = helper_code(file_text, "coded_error")
        found.append((screaming(helper) if helper else None, quoted.group(1), path))
    if completion and not commandish and ("Err(" in window or "ok_or" in window):
        for match in quoted_re.finditer(window):
            token = match.group(1)
            if is_reason(token):
                found.append(("ISSUE_VALIDATION_FAILED", token, path))
    return found


def added_windows():
    hits = []
    if from_ref:
        diff = git("diff", "-U0", f"{from_ref}...HEAD", "--", "src-tauri/src")
        files = {}
    else:
        diff = git("diff", "-U0", "HEAD", "--", "src-tauri/src")
        files = {}
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
        if not is_source(path):
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            if path not in files:
                files[path] = read_text(path)
            hits.extend(requirements_in_window(path, window_at(files[path], new_line), files[path]))
            new_line += 1
        elif raw.startswith("-") and not raw.startswith("---"):
            continue
        else:
            new_line += 1
    if not from_ref:
        listing = git("ls-files", "--others", "--exclude-standard", "--", "src-tauri/src")
        for rel in listing.splitlines():
            if not is_source(rel):
                continue
            text = read_text(rel)
            hits.extend(requirements_in_window(rel, text, text))
    return hits


def load_locales():
    loaded = {}
    for name in ("zh", "en"):
        path = os.path.join(root, "src/shared/i18n/locales", f"{name}.json")
        with open(path, encoding="utf-8") as handle:
            loaded[name] = json.load(handle)
    return loaded


def has_key(locale, code, token):
    block = locale.get("errors", {}).get(code)
    if not isinstance(block, dict):
        return False
    value = block.get(token)
    return isinstance(value, str) and value.strip() != ""


def missing_messages(hits, locales):
    missing = []
    seen = set()
    for code, token, path in hits:
        if code is None:
            item = (path, token, "unresolved")
            if item not in seen:
                seen.add(item)
                missing.append(f"  {token} 在 {path} 找不到同一处的 CommandErrorCode")
            continue
        for name, locale in locales.items():
            if has_key(locale, code, token):
                continue
            item = (code, token, name)
            if item in seen:
                continue
            seen.add(item)
            missing.append(
                f"  {token} 需要 errors.{code}.{token}（{name} 缺失）"
            )
    return missing


def self_test():
    sample = """
fn coded_error(reason: &str, message: &str) -> CommandError {
    CommandError::new(CommandErrorCode::ProjectValidationFailed, message).with_reason(reason)
}
fn create() {
    return Err(coded_error(
        \"changeRequestLinkMissing\",
        \"A remote issue is required.\",
    ));
}
"""
    hits = requirements_in_window(
        "src-tauri/src/features/project/change_request_commands.rs",
        sample,
        sample,
    )
    assert ("PROJECT_VALIDATION_FAILED", "changeRequestLinkMissing", "src-tauri/src/features/project/change_request_commands.rs") in hits
    completion = """
fn publish() -> Result<(), String> {
    number.ok_or_else(|| \"changeRequestNumberMissing\".to_string())?;
    Ok(())
}
"""
    completion_hits = requirements_in_window(
        "src-tauri/src/features/issue/completion/publish.rs",
        completion,
        completion,
    )
    assert (
        "ISSUE_VALIDATION_FAILED",
        "changeRequestNumberMissing",
        "src-tauri/src/features/issue/completion/publish.rs",
    ) in completion_hits
    locales = {
        "zh": {"errors": {"PROJECT_VALIDATION_FAILED": {"changeRequestLinkMissing": "选一个"}, "ISSUE_VALIDATION_FAILED": {}}},
        "en": {"errors": {"PROJECT_VALIDATION_FAILED": {"changeRequestLinkMissing": "Choose"}, "ISSUE_VALIDATION_FAILED": {}}},
    }
    missed = missing_messages(completion_hits, locales)
    assert any("ISSUE_VALIDATION_FAILED.changeRequestNumberMissing" in item and "zh" in item for item in missed)
    locales["zh"]["errors"]["ISSUE_VALIDATION_FAILED"]["changeRequestNumberMissing"] = "读不到编号"
    locales["en"]["errors"]["ISSUE_VALIDATION_FAILED"]["changeRequestNumberMissing"] = "Missing number"
    assert missing_messages(hits + completion_hits, locales) == []
    print("reason locale 自检通过。")


if os.environ.get("RRL_SELF_TEST") == "1":
    self_test()
    sys.exit(0)

hits = added_windows()
if not hits:
    print("没有新增 reason。locale 检查通过。")
    sys.exit(0)

missing = missing_messages(hits, load_locales())
if missing:
    print("新增 reason 没有写到对应错误码的中英文文案。")
    print("with_reason / coded_error 用 errors.<CommandErrorCode>.<reason>。")
    print("完成流返回的裸 reason 用 errors.ISSUE_VALIDATION_FAILED.<reason>。")
    for item in missing:
        print(item)
    sys.exit(1)

print("新增 reason 的 locale 检查通过。")
PY
