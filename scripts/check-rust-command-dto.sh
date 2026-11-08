#!/usr/bin/env bash
# diff 里增删的命令返回字段必须和 Tauri 契约同一段落一致。
# 只检查 serde camelCase 结构体里含大写字母的字段名。单字小写字段不查。存量不追溯。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RUS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FROM_REF=""

usage() {
  cat <<'USAGE'
用法:
  check-rust-command-dto.sh              检查相对 HEAD 的未提交 DTO 字段
  check-rust-command-dto.sh --from <ref> 检查 <ref>..HEAD 的 DTO 字段
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
struct_re = re.compile(r"(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)\b")
field_re = re.compile(r"pub(?:\([^)]*\))?\s+([A-Za-z0-9_]+)\s*:")
rename_re = re.compile(r'#\[serde\([^\]]*rename\s*=\s*"([^"]+)"')
skip_re = re.compile(r"#\[serde\([^\]]*\bskip(?:_serializing)?\b")
fn_re = re.compile(r"\bfn\s+([a-z0-9_]+)\s*\(")
type_name_re = re.compile(r"[A-Z][A-Za-z0-9_]*")
word_re_cache = {}


def git(*args):
    return subprocess.check_output(
        ["git", *args], text=True, errors="replace", stderr=subprocess.DEVNULL
    )


def git_ok(*args):
    try:
        return git(*args)
    except subprocess.CalledProcessError:
        return ""


def is_source(path):
    if not path.endswith(".rs") or not path.startswith("src-tauri/src/"):
        return False
    name = os.path.basename(path)
    if name.endswith("_test.rs") or name.endswith("_tests.rs"):
        return False
    return "/tests/" not in path


def snake_to_camel(name):
    parts = name.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def has_upper(token):
    return any(char.isupper() for char in token)


def word_in(token, text):
    pattern = word_re_cache.get(token)
    if pattern is None:
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(token)}(?![A-Za-z0-9_])")
        word_re_cache[token] = pattern
    return pattern.search(text) is not None


def parse_file(text):
    lines = text.splitlines()
    structs = {}
    types = {}
    commands = {}
    index = 0
    while index < len(lines):
        match = struct_re.match(lines[index].strip())
        if not match:
            index += 1
            continue
        window = "\n".join(lines[max(0, index - 12) : index])
        if 'rename_all = "camelCase"' not in window:
            index += 1
            continue
        name = match.group(1)
        fields = {}
        field_types = []
        index += 1
        pending_rename = None
        pending_skip = False
        while index < len(lines) and lines[index].strip() != "}":
            stripped = lines[index].strip()
            rename = rename_re.search(stripped)
            if rename and "rename_all" not in stripped:
                pending_rename = rename.group(1)
            if skip_re.search(stripped):
                pending_skip = True
            field = field_re.match(stripped)
            if field and not pending_skip:
                fields[field.group(1)] = pending_rename or snake_to_camel(field.group(1))
                field_types.append(stripped.split(":", 1)[1])
                pending_rename = None
                pending_skip = False
            elif field:
                pending_rename = None
                pending_skip = False
            index += 1
        structs[name] = fields
        types[name] = field_types
        index += 1
    for index, line in enumerate(lines):
        found = fn_re.search(line)
        if not found:
            continue
        window = "\n".join(lines[max(0, index - 8) : index + 1])
        if "tauri::command" not in window:
            continue
        blob = "\n".join(lines[index : index + 12])
        result = re.search(r"->\s*Result<\s*([^,]+)", blob)
        if result:
            commands[found.group(1)] = result.group(1).strip()
    return structs, types, commands


def referenced(type_text, structs):
    return {name for name in type_name_re.findall(type_text) if name in structs}


def reachable(type_text, structs, types):
    seen = set()
    stack = list(referenced(type_text, structs))
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        for field_type in types.get(name, []):
            for nested in referenced(field_type, structs):
                if nested not in seen:
                    stack.append(nested)
    return seen


def show_file(ref, path):
    if ref == "WORKTREE":
        full = os.path.join(root, path)
        if not os.path.isfile(full):
            return ""
        with open(full, encoding="utf-8") as handle:
            return handle.read()
    return git_ok("show", f"{ref}:{path}")


def list_sources(ref):
    if ref == "WORKTREE":
        tracked = git("ls-files", "--", "src-tauri/src").splitlines()
        untracked = git(
            "ls-files", "--others", "--exclude-standard", "--", "src-tauri/src"
        ).splitlines()
        paths = tracked + untracked
    else:
        paths = git("ls-tree", "-r", "--name-only", ref, "src-tauri/src").splitlines()
    return [path for path in paths if is_source(path)]


def changed_sources(old_ref, new_ref):
    if new_ref == "WORKTREE":
        names = git("diff", "--name-only", old_ref, "--", "src-tauri/src").splitlines()
        names += git(
            "ls-files", "--others", "--exclude-standard", "--", "src-tauri/src"
        ).splitlines()
    else:
        names = git(
            "diff", "--name-only", f"{old_ref}...{new_ref}", "--", "src-tauri/src"
        ).splitlines()
    return sorted({path for path in names if is_source(path)})


def load(ref, paths):
    structs = {}
    types = {}
    commands = {}
    for path in paths:
        file_structs, file_types, file_commands = parse_file(show_file(ref, path))
        structs.update(file_structs)
        types.update(file_types)
        commands.update(file_commands)
    return structs, types, commands


if from_ref:
    old_ref = from_ref
    new_ref = "HEAD"
else:
    old_ref = "HEAD"
    new_ref = "WORKTREE"

changed = changed_sources(old_ref, new_ref)
if not changed:
    print("没有变更的命令 DTO。契约检查通过。")
    sys.exit(0)

new_structs, new_types, new_commands = load(new_ref, list_sources(new_ref))
old_structs, _old_types, _old_commands = load(old_ref, list_sources(old_ref))

reached_by = {}
for command, type_text in new_commands.items():
    for struct_name in reachable(type_text, new_structs, new_types):
        reached_by.setdefault(struct_name, set()).add(command)

with open(contract_path, encoding="utf-8") as handle:
    blocks = re.split(r"\n\s*\n", handle.read())

missing = []
stale = []
seen = set()
for path in changed:
    names = set(parse_file(show_file(new_ref, path))[0])
    names.update(parse_file(show_file(old_ref, path))[0])
    for struct_name in names:
        commands = reached_by.get(struct_name)
        if not commands:
            continue
        before = set(old_structs.get(struct_name, {}).values())
        after = set(new_structs.get(struct_name, {}).values())
        scoped = []
        for command in sorted(commands):
            scoped.extend(block for block in blocks if word_in(command, block))
        for name in sorted(after - before):
            if not has_upper(name):
                continue
            key = ("add", struct_name, name)
            if key in seen:
                continue
            seen.add(key)
            if not any(word_in(name, block) for block in scoped):
                missing.append(f"{struct_name}.{name}（{', '.join(sorted(commands))}）")
        for name in sorted(before - after):
            if not has_upper(name):
                continue
            key = ("del", struct_name, name)
            if key in seen:
                continue
            seen.add(key)
            if any(word_in(name, block) for block in scoped):
                stale.append(f"{struct_name}.{name}（{', '.join(sorted(commands))}）")

if missing or stale:
    if missing:
        print("新增的命令返回字段没有写入对应契约段落。")
        for item in missing:
            print(f"  {item}")
    if stale:
        print("已删除的命令返回字段仍留在对应契约段落。")
        for item in stale:
            print(f"  {item}")
    sys.exit(1)

print("命令 DTO 字段的契约检查通过。")
PY
