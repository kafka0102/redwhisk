# Rust 单文件大小强制机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为后端 Rust 复刻前端已有的「规范文字 + 任务路由 + 门禁」三层单文件大小约束闭环，并把 Rust 的约束做成硬门禁，阻止 Agent 在单个 `.rs` 文件持续堆砌代码。

**Architecture:** 新增一份对标 `frontend-large-component-splitting-rules.md` 的专项规范文档与一个 bash 门禁脚本。脚本默认只检查本次 git 改动触及的 `.rs` 文件，存量超阈值文件登记进白名单豁免，越界且未豁免则非零退出。规范经 `AGENTS.md` §4 任务路由与 §5 质量门禁落地，使 Agent 改 Rust 时被强制看到并执行。

**Tech Stack:** bash 3.2 兼容脚本（macOS 默认 `/usr/bin/env bash` 为 3.2.57，禁用 `mapfile`）、Markdown 文档。

## Global Constraints

- 阈值（沿用 ADR 0013）：常规 `.rs` ≤ **500** 行；编排主文件 ≤ **800** 行；任何文件硬上限 ≤ **1000** 行。
- 编排主文件客观判定：相对仓库根路径匹配 `src-tauri/src/features/*/service.rs` 或 `src-tauri/src/features/*/commands.rs`，阈值 800；其余 500。
- 门禁默认只检查本次 git 改动触及的 `.rs` 文件（已跟踪改动 + 未跟踪新文件），不扫全仓。
- 存量超阈值文件进 `scripts/rust-file-size-allowlist.txt` 豁免；白名单仅登记「本次改动前已超阈值」的存量文件，禁止放入新建文件。
- 脚本必须兼容 bash 3.2：禁用 `mapfile`/`readarray`；空数组在 `set -u` 下用 `${arr[@]+"${arr[@]}"}` 保护；文件列表用 `while IFS= read` + 进程替换。
- 所有输出用简体中文；文档改动豁免 `pnpm lint/typecheck/test`，但须用 `rg` 复查内部相对链接与索引一致。
- 提交直接在 `main` 分支（项目惯例），commit 标题 `<type>: <简体中文描述>`，不 `push`/`merge`/`rebase`。
- 脚本路径常量允许环境变量覆盖以便测试：`RFS_ROOT`（仓库根）、`RFS_ALLOWLIST`（白名单路径）。

---

### Task 1: 门禁脚本 `scripts/check-rust-file-size.sh`

**Files:**
- Create: `scripts/check-rust-file-size.sh`
- Test: 临时 fixture（`/tmp/rfstest/**`），验证后清理，不入仓

**Interfaces:**
- Produces: `scripts/check-rust-file-size.sh`，退出码 0=通过、1=有违规；支持 `--files`/`--all`/`--all --names-only`/默认 git 模式；读 `RFS_ROOT`、`RFS_ALLOWLIST` 环境变量。Task 2 依赖 `--all --names-only` 生成白名单初始清单。

- [ ] **Step 1: 创建脚本文件**

写入 `scripts/check-rust-file-size.sh`：

```bash
#!/usr/bin/env bash
# Rust 单文件大小门禁脚本
# 规范: docs/architecture-design/backend-large-file-splitting-rules.md
# 阈值（沿用 ADR 0013）: 常规 500 / 编排主文件 800 / 硬上限 1000
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RFS_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SRC_ROOT="$REPO_ROOT/src-tauri/src"
ALLOWLIST="${RFS_ALLOWLIST:-$SCRIPT_DIR/rust-file-size-allowlist.txt}"

LIMIT_REGULAR=500
LIMIT_ORCHESTRATION=800
LIMIT_HARD=1000

# 相对仓库根的路径（用于显示与通配判定）
relpath() {
  local f="$1"
  if [[ "$f" == "$REPO_ROOT"/* ]]; then
    echo "${f#"$REPO_ROOT"/}"
  else
    echo "$f"
  fi
}

# 返回文件适用的阈值（编排主文件 800，其余 500）
threshold_for() {
  local rel="$1"
  if [[ "$rel" == src-tauri/src/features/*/service.rs ]] \
     || [[ "$rel" == src-tauri/src/features/*/commands.rs ]]; then
    echo "$LIMIT_ORCHESTRATION"
  else
    echo "$LIMIT_REGULAR"
  fi
}

# 打印白名单相对路径（去掉注释与首尾空白），忽略空行
allowlist_paths() {
  [[ -f "$ALLOWLIST" ]] || return 0
  awk '{
    sub(/\r$/,"");
    line=$0;
    sub(/#.*/,"",line);
    gsub(/^[ \t]+|[ \t]+$/,"",line);
    if (line!="") print line
  }' "$ALLOWLIST"
}

is_allowlisted() {
  local rel="$1" p
  while IFS= read -r p; do
    [[ "$p" == "$rel" ]] && return 0
  done < <(allowlist_paths)
  return 1
}

# 判定单个文件是否超阈值；超阈值则 stdout 打印 "<kind>|<threshold>"
# kind=hard 表示超硬上限，kind=over 表示超类型阈值
classify() {
  local f="$1" rel lines thr
  rel="$(relpath "$f")"
  [[ "$rel" == *.rs ]] || return 0
  [[ -f "$f" ]] || return 0
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  thr="$(threshold_for "$rel")"
  if (( lines > LIMIT_HARD )); then
    printf 'hard|%s\n' "$LIMIT_HARD"
  elif (( lines > thr )); then
    printf 'over|%s\n' "$thr"
  fi
  return 0
}

VIOL=0

# 检查单个文件并打印报告；违规则 VIOL++
report_file() {
  local f="$1" rel lines cls
  rel="$(relpath "$f")"
  [[ "$rel" == *.rs ]] || return 0
  [[ -f "$f" ]] || return 0
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  if is_allowlisted "$rel"; then
    printf '  [allowlisted] %s (%s lines, 存量待拆分)\n' "$rel" "$lines"
    return 0
  fi
  cls="$(classify "$f")"
  if [[ -n "$cls" ]]; then
    local kind="${cls%%|*}" thr="${cls##*|}"
    if [[ "$kind" == hard ]]; then
      printf '  [VIOLATION] %s: %s lines > 硬上限 %s\n' "$rel" "$lines" "$thr"
    else
      printf '  [VIOLATION] %s: %s lines > 阈值 %s\n' "$rel" "$lines" "$thr"
    fi
    VIOL=$((VIOL+1))
  fi
}

# 白名单护栏：白名单内文件不得是仓库内「无 git 历史」的新建文件
check_allowlist_no_new_files() {
  [[ -f "$ALLOWLIST" ]] || return 0
  local p
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    [[ -f "$REPO_ROOT/$p" ]] || continue
    if ! git -C "$REPO_ROOT" log -1 --format=%H -- "$p" 2>/dev/null | grep -q .; then
      printf '  [VIOLATION] 白名单包含新建文件 %s（白名单仅登记存量，禁止放入新建文件）\n' "$p"
      VIOL=$((VIOL+1))
    fi
  done < <(allowlist_paths)
}

collect_changed_rust_files() {
  git -C "$REPO_ROOT" diff --name-only HEAD -- '*.rs' 2>/dev/null || true
  git -C "$REPO_ROOT" ls-files --others --exclude-standard -- '*.rs' 2>/dev/null || true
}

usage() {
  cat <<'USAGE'
用法:
  check-rust-file-size.sh                     检查本次 git 改动触及的 .rs 文件（门禁默认）
  check-rust-file-size.sh --files f1 f2 ..    检查指定文件（测试用）
  check-rust-file-size.sh --all               扫描全仓，打印报告（不阻断）
  check-rust-file-size.sh --all --names-only  仅打印超阈值路径（维护白名单用）
环境变量:
  RFS_ROOT       仓库根路径（默认脚本上级目录）
  RFS_ALLOWLIST  白名单路径（默认 scripts/rust-file-size-allowlist.txt）
USAGE
}

mode=git
names_only=0
files=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) mode=all; shift;;
    --files) mode=files; shift;;
    --names-only) names_only=1; shift;;
    -h|--help) usage; exit 0;;
    *) files+=("$1"); shift;;
  esac
done

case "$mode" in
  all)
    if [[ "$names_only" == 1 ]]; then
      while IFS= read -r f; do
        rel="$(relpath "$f")"
        is_allowlisted "$rel" && continue
        cls="$(classify "$f")"
        [[ -n "$cls" ]] && printf '%s\n' "$rel"
      done < <(find "$SRC_ROOT" -name '*.rs' -type f | sort)
      exit 0
    fi
    echo "扫描全仓 Rust 文件 (--all):"
    while IFS= read -r f; do
      report_file "$f"
    done < <(find "$SRC_ROOT" -name '*.rs' -type f | sort)
    exit 0
    ;;
  files)
    echo "检查指定文件 (--files):"
    for f in "${files[@]+"${files[@]}"}"; do report_file "$f"; done
    check_allowlist_no_new_files
    ;;
  git)
    echo "检查本次 git 改动触及的 Rust 文件:"
    changed="$(collect_changed_rust_files | sort -u)"
    if [[ -z "$changed" ]]; then
      echo "  (无 Rust 文件改动)"
    else
      while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue
        report_file "$REPO_ROOT/$rel"
      done <<< "$changed"
    fi
    check_allowlist_no_new_files
    ;;
esac

if (( VIOL > 0 )); then
  echo
  printf '失败: %s 个违规。拆分指引见 docs/architecture-design/backend-large-file-splitting-rules.md\n' "$VIOL"
  exit 1
fi
echo "通过: 无违规。"
exit 0
```

- [ ] **Step 2: 赋予执行权限**

Run: `chmod +x scripts/check-rust-file-size.sh`

- [ ] **Step 3: 验证常规文件阈值违规与通过**

```bash
mkdir -p /tmp/rfstest/src-tauri/src/agent
yes '//' | head -n 501 > /tmp/rfstest/src-tauri/src/agent/big.rs
yes '//' | head -n 499 > /tmp/rfstest/src-tauri/src/agent/ok.rs
RFS_ROOT=/tmp/rfstest bash scripts/check-rust-file-size.sh --files /tmp/rfstest/src-tauri/src/agent/big.rs; echo "exit=$?"
```
Expected: 输出含 `[VIOLATION] src-tauri/src/agent/big.rs: 501 lines > 阈值 500`，`exit=1`。

```bash
RFS_ROOT=/tmp/rfstest bash scripts/check-rust-file-size.sh --files /tmp/rfstest/src-tauri/src/agent/ok.rs; echo "exit=$?"
```
Expected: 输出 `通过: 无违规。`，`exit=0`。

- [ ] **Step 4: 验证编排主文件判定（800 阈值）**

```bash
mkdir -p /tmp/rfstest/src-tauri/src/features/demo
yes '//' | head -n 801 > /tmp/rfstest/src-tauri/src/features/demo/service.rs
yes '//' | head -n 799 > /tmp/rfstest/src-tauri/src/features/demo/commands.rs
RFS_ROOT=/tmp/rfstest bash scripts/check-rust-file-size.sh --files \
  /tmp/rfstest/src-tauri/src/features/demo/service.rs \
  /tmp/rfstest/src-tauri/src/features/demo/commands.rs; echo "exit=$?"
```
Expected: 输出含 `service.rs: 801 lines > 阈值 800`（违规），`commands.rs` 不出现在 VIOLATION 中，`exit=1`。

- [ ] **Step 5: 验证硬上限 1000（编排文件超 1000 仍违规）**

```bash
yes '//' | head -n 1001 > /tmp/rfstest/src-tauri/src/features/demo/service.rs
RFS_ROOT=/tmp/rfstest bash scripts/check-rust-file-size.sh --files /tmp/rfstest/src-tauri/src/features/demo/service.rs; echo "exit=$?"
```
Expected: 输出含 `service.rs: 1001 lines > 硬上限 1000`，`exit=1`。

- [ ] **Step 6: 验证白名单豁免（跳过并提示存量）**

```bash
printf 'src-tauri/src/agent/big.rs\n' > /tmp/rfstest/allow.txt
RFS_ROOT=/tmp/rfstest RFS_ALLOWLIST=/tmp/rfstest/allow.txt bash scripts/check-rust-file-size.sh --files /tmp/rfstest/src-tauri/src/agent/big.rs; echo "exit=$?"
```
（先把 big.rs 恢复为 501 行：`yes '//' | head -n 501 > /tmp/rfstest/src-tauri/src/agent/big.rs`）

Expected: 输出含 `[allowlisted] src-tauri/src/agent/big.rs (501 lines, 存量待拆分)`，`exit=0`。

- [ ] **Step 7: 验证 `--all --names-only` 在真实仓库列出超阈值文件**

```bash
bash scripts/check-rust-file-size.sh --all --names-only | head -5
```
Expected: 输出多行 `src-tauri/src/...` 路径，含 `src-tauri/src/features/agent_session/service.rs`（当前 5860 行，超阈值）。此时白名单尚未创建，故不被排除。

- [ ] **Step 8: 验证新建文件入白名单会被报错**

```bash
# big.rs 位于非 git 目录，git log 无历史 → 视为新建文件
RFS_ROOT=/tmp/rfstest RFS_ALLOWLIST=/tmp/rfstest/allow.txt bash scripts/check-rust-file-size.sh --files /tmp/rfstest/src-tauri/src/agent/ok.rs; echo "exit=$?"
```
Expected: 输出含 `[VIOLATION] 白名单包含新建文件 src-tauri/src/agent/big.rs`，`exit=1`。

- [ ] **Step 9: 清理 fixture**

```bash
rm -rf /tmp/rfstest
```

- [ ] **Step 10: 复查工作区并提交**

Run: `git status --short`
Expected: 仅 `scripts/check-rust-file-size.sh` 为新文件。

```bash
git add scripts/check-rust-file-size.sh
git commit -m "feat: 新增 Rust 单文件大小门禁脚本 check-rust-file-size

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 存量白名单 `scripts/rust-file-size-allowlist.txt`

**Files:**
- Create: `scripts/rust-file-size-allowlist.txt`

**Interfaces:**
- Consumes: Task 1 的 `--all --names-only` 输出（当前全部超阈值文件路径）。
- Produces: 白名单文件，供 Task 1 脚本 git 模式与 `--all` 模式豁免存量。后续改 Rust 的任务依赖它避免误报。

- [ ] **Step 1: 用脚本生成超阈值路径清单**

Run:
```bash
bash scripts/check-rust-file-size.sh --all --names-only
```
Expected: 输出当前所有超阈值 `.rs` 文件路径（纯路径，每行一个，按字典序），共 25 条，与下表一致：
```
src-tauri/src/agent/agent_event_broadcaster.rs
src-tauri/src/agent/claude_streaming/event_mapper.rs
src-tauri/src/agent/claude_streaming/message.rs
src-tauri/src/agent/claude_streaming/session.rs
src-tauri/src/agent/claude_streaming/transport.rs
src-tauri/src/agent/codex_app_server/session.rs
src-tauri/src/agent/codex_app_server/thread_item.rs
src-tauri/src/agent/codex_app_server/transport.rs
src-tauri/src/agent/command_detector.rs
src-tauri/src/agent/provider_factory.rs
src-tauri/src/agent/pty_session_manager.rs
src-tauri/src/db/agent_session_repository.rs
src-tauri/src/db/issue_repository.rs
src-tauri/src/db/migrations.rs
src-tauri/src/features/agent_session/commands.rs
src-tauri/src/features/agent_session/service.rs
src-tauri/src/features/agent_session/timeline.rs
src-tauri/src/features/agent_session/workspace.rs
src-tauri/src/features/issue/completion/effect_interpreter.rs
src-tauri/src/features/issue/completion/flow.rs
src-tauri/src/features/issue/completion/state_machine.rs
src-tauri/src/features/issue/service.rs
src-tauri/src/features/project_terminal/service.rs
src-tauri/src/features/settings/service.rs
src-tauri/src/git/worktree.rs
```
说明：`features/*/service.rs`、`features/*/commands.rs` 走编排阈值 800，其余走 500，所有文件共用硬上限 1000。`features/issue/commands.rs`（566）、`features/app_update/service.rs`（545）均 < 800，不在上表。以脚本实际输出为准，若与上表不一致以实际输出核对 `wc -l`。

- [ ] **Step 2: 创建白名单文件**

把 Step 1 实际输出的每一个路径写入 `scripts/rust-file-size-allowlist.txt`，文件格式如下（首部固定注释 + 每行 `<路径> # <行数> lines, registered 2026-07-18`，行数取 `wc -l` 实测值）：

```
# Rust 单文件大小白名单（存量超阈值待拆分 backlog）
# 格式: <相对仓库根路径> # <行数> lines, registered 2026-07-18
# 仅登记“本次改动前已超阈值”的存量文件；新建文件禁止加入（脚本会报错）。
# 阈值: 常规 500 / 编排主文件(service.rs|commands.rs under features/*) 800 / 硬上限 1000。
src-tauri/src/features/agent_session/service.rs # 5860 lines, registered 2026-07-18
src-tauri/src/features/issue/service.rs # 4739 lines, registered 2026-07-18
src-tauri/src/features/project_terminal/service.rs # 2790 lines, registered 2026-07-18
src-tauri/src/agent/claude_streaming/session.rs # 2623 lines, registered 2026-07-18
src-tauri/src/agent/codex_app_server/session.rs # 1742 lines, registered 2026-07-18
src-tauri/src/features/agent_session/workspace.rs # 1686 lines, registered 2026-07-18
src-tauri/src/db/agent_session_repository.rs # 1571 lines, registered 2026-07-18
src-tauri/src/db/issue_repository.rs # 1029 lines, registered 2026-07-18
src-tauri/src/agent/pty_session_manager.rs # 1025 lines, registered 2026-07-18
src-tauri/src/features/settings/service.rs # 1018 lines, registered 2026-07-18
src-tauri/src/features/agent_session/commands.rs # 914 lines, registered 2026-07-18
src-tauri/src/git/worktree.rs # 942 lines, registered 2026-07-18
src-tauri/src/features/issue/completion/effect_interpreter.rs # 878 lines, registered 2026-07-18
src-tauri/src/agent/codex_app_server/transport.rs # 865 lines, registered 2026-07-18
src-tauri/src/agent/agent_event_broadcaster.rs # 790 lines, registered 2026-07-18
src-tauri/src/features/issue/completion/state_machine.rs # 784 lines, registered 2026-07-18
src-tauri/src/agent/codex_app_server/thread_item.rs # 763 lines, registered 2026-07-18
src-tauri/src/agent/claude_streaming/message.rs # 744 lines, registered 2026-07-18
src-tauri/src/agent/claude_streaming/transport.rs # 612 lines, registered 2026-07-18
src-tauri/src/features/agent_session/timeline.rs # 605 lines, registered 2026-07-18
src-tauri/src/features/issue/completion/flow.rs # 602 lines, registered 2026-07-18
src-tauri/src/db/migrations.rs # 573 lines, registered 2026-07-18
src-tauri/src/agent/command_detector.rs # 535 lines, registered 2026-07-18
src-tauri/src/agent/provider_factory.rs # 518 lines, registered 2026-07-18
src-tauri/src/agent/claude_streaming/event_mapper.rs # 515 lines, registered 2026-07-18
```
要求：以 Step 1 实际输出为准核对，**不遗漏**任何超阈值文件。可逐行用 `wc -l < <路径>` 校正行数注释。

- [ ] **Step 3: 自检白名单覆盖度（关键）**

Run:
```bash
bash scripts/check-rust-file-size.sh --all --names-only
```
Expected: **输出为空**。这证明所有当前超阈值文件都已入白名单（`--names-only` 会跳过白名单内文件）。若仍有输出，把漏掉的路径补进白名单后重跑，直到输出为空。

- [ ] **Step 4: 验证 `--all` 报告模式对存量显示 allowlisted 且不阻断**

Run:
```bash
bash scripts/check-rust-file-size.sh --all | head -3; echo "exit=${PIPESTATUS[0]}"
```
Expected: 前 3 行含 `[allowlisted]` 标注，`exit=0`（`--all` 是报告模式，不阻断）。

- [ ] **Step 5: 复查工作区并提交**

Run: `git status --short`
Expected: 仅 `scripts/rust-file-size-allowlist.txt` 为新文件。

```bash
git add scripts/rust-file-size-allowlist.txt
git commit -m "feat: 登记存量超阈值 Rust 文件白名单

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 专项规范 `docs/architecture-design/backend-large-file-splitting-rules.md`

**Files:**
- Create: `docs/architecture-design/backend-large-file-splitting-rules.md`

**Interfaces:**
- Produces: Rust 单文件复杂度专项规则，被 Task 4（agent-development-rules 章节）、Task 5（AGENTS.md §4/§5、README 索引）引用，也是脚本 `失败` 提示指向的拆分指引。

- [ ] **Step 1: 创建专项规范文档**

写入 `docs/architecture-design/backend-large-file-splitting-rules.md`：

````markdown
# 后端 Rust 大文件拆分规则

## 目标

当 `src-tauri/src/**` 下单个 `.rs` 文件承载多个业务子领域、多个 command 分组或混杂的编排逻辑时，应优先按职责聚簇拆分，降低单文件代码量，同时保持运行时行为不变。

本规则是 [Agent 开发通用规则](./agent-development-rules.md) 中「后端 Rust 文件复杂度」章节的专项补充，并与 [前端大型组件拆分规则](./frontend-large-component-splitting-rules.md) 对称。它把 [ADR 0013](../adr/0013-feature-first-module-organization.md) 已采纳的「单文件目标 ≤ 500 行，编排主文件可到 800」从目标值升级为强制门禁。

## 行数阈值

- 常规 `.rs` 文件 ≤ **500 行**。
- 编排主文件 ≤ **800 行**：相对仓库根路径匹配 `src-tauri/src/features/*/service.rs` 或 `src-tauri/src/features/*/commands.rs`。
- 硬上限 ≤ **1000 行**：任何文件不得超过，含编排主文件。

阈值由 `scripts/check-rust-file-size.sh` 强制执行，`AGENTS.md` §5 质量门禁在每次改动 Rust 后调用。

## 门禁触发模型

- 门禁默认只检查本次 git 改动触及的 `.rs` 文件（已跟踪改动 + 未跟踪新文件），不扫全仓。
- 越界文件若在 `scripts/rust-file-size-allowlist.txt` 中登记 → 跳过并提示「存量待拆分」。
- 越界且未登记 → 脚本非零退出，任务不算完成（见 `AGENTS.md` §5）。
- 白名单仅登记「本次改动前已超阈值」的存量文件；**禁止把新建文件塞进白名单**，脚本会检测并报错。
- 维护白名单：`bash scripts/check-rust-file-size.sh --all --names-only` 列出当前全部超阈值文件。

## 拆分边界

- `features/<feature>/service.rs`：按子领域或用例拆为同 feature 下的子模块（如 `service/launch.rs`、`service/timeline.rs`），主文件只保留编排与对外入口。
- `features/<feature>/commands.rs`：按 command 分组拆为 `commands/<group>.rs`，主文件聚合 `generate_handler!` 注册。
- `db/<entity>_repository.rs`：按实体拆为 `db/<feature>/<entity>.rs`。
- `agent/<provider>/session.rs`：按协议阶段（握手、流式、收尾）或消息类型拆子模块。
- 子模块通过 `mod.rs` 或文件级 `mod` 声明聚合，不得跨 feature 引用对方私有子模块。

## 拆分纪律

- 不得为满足行数限制做无语义机械拆分；拆分后的模块必须有清晰单一职责，降低理解成本。
- 拆分须保持运行时行为不变：命令签名、事件 payload、错误类型、SQL 与事务边界不得改变。
- 优先做「纯移动」：搬移函数/结构体到新文件，调整 `use` 与 `mod`，不改实现。

## 验收要求

- 拆分后运行 `cargo test --lib`（集成测试有预存失败，回归判定用 `--lib`）。
- 拆分后运行 `bash scripts/check-rust-file-size.sh --files <被拆分的主文件>`，确认主文件与新子文件均不再越界（除非新子文件本身进白名单，但新建文件不得入白名单，故必须直接达标）。
- 提交说明记录新增子模块边界，便于后续继续拆同类文件。
````

- [ ] **Step 2: 复查内部相对链接**

Run:
```bash
rg -n "agent-development-rules|frontend-large-component-splitting-rules|0013-feature-first" docs/architecture-design/backend-large-file-splitting-rules.md
```
Expected: 三处引用均指向已存在文件（`./agent-development-rules.md`、`./frontend-large-component-splitting-rules.md`、`../adr/0013-feature-first-module-organization.md`）。

- [ ] **Step 3: 复查工作区并提交**

Run: `git status --short`
Expected: 仅新文档一个文件。

```bash
git add docs/architecture-design/backend-large-file-splitting-rules.md
git commit -m "docs: 新增后端 Rust 大文件拆分规则专项文档

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `agent-development-rules.md` 增加「后端 Rust 文件复杂度」章节

**Files:**
- Modify: `docs/architecture-design/agent-development-rules.md`（在第 62 行「前端文件复杂度与组件化」章节末尾之后、「## 数据与状态规则」之前插入新章节）

**Interfaces:**
- Consumes: Task 3 的专项文档作为「专项补充」链接目标。
- Produces: 通用规则里的 Rust 复杂度原则，被 Task 5 的 `AGENTS.md` §4 任务路由引用。

- [ ] **Step 1: 插入新章节**

用 Edit，`old_string`：

```
- 不得为了满足行数限制进行无语义的机械拆分；拆分后的模块必须有清晰职责，并能降低页面、状态或渲染逻辑的理解成本。

## 数据与状态规则
```

`new_string`：

```
- 不得为了满足行数限制进行无语义的机械拆分；拆分后的模块必须有清晰职责，并能降低页面、状态或渲染逻辑的理解成本。

## 后端 Rust 文件复杂度

后端 Rust 实现必须控制单文件复杂度，避免单个 `.rs` 文件承载过多职责。本节是 [后端 Rust 大文件拆分规则](./backend-large-file-splitting-rules.md) 的原则入口，行数阈值与拆分边界以专项文档为准。

必须遵守：

- 常规 `.rs` 文件原则上不得超过 500 行；编排主文件（`features/*/service.rs`、`features/*/commands.rs`）不得超过 800 行；任何文件硬上限 1000 行。
- 新增或修改 Rust 功能时，如果目标文件接近或超过上述阈值，必须优先按职责聚簇拆分为同 feature 下的子模块，而不是继续追加代码。
- 每次改动 Rust 后必须运行 `bash scripts/check-rust-file-size.sh`（见 `AGENTS.md` §5 质量门禁），越界且未在 `scripts/rust-file-size-allowlist.txt` 登记的文件会让脚本非零退出，任务不算完成。

例外要求：

- 现有存量超阈值文件已登记进白名单，作为待拆分 backlog；改动这些文件时应顺手按专项文档边界拆分，并在拆分后从白名单移除对应条目。
- 不得为满足行数限制做无语义机械拆分；不得把新建文件塞进白名单以规避门禁（脚本会报错）。
- 如确有特殊原因需要让单文件超过阈值，必须在最终回复或提交说明中明确说明原因、风险与后续拆分建议。

## 数据与状态规则
```

- [ ] **Step 2: 复查链接目标存在**

Run:
```bash
test -f docs/architecture-design/backend-large-file-splitting-rules.md && echo OK
rg -n "后端 Rust 文件复杂度" docs/architecture-design/agent-development-rules.md
```
Expected: 输出 `OK` 且章节标题出现一次。

- [ ] **Step 3: 复查工作区并提交**

Run: `git status --short`
Expected: 仅 `agent-development-rules.md` 一个改动文件。

```bash
git add docs/architecture-design/agent-development-rules.md
git commit -m "docs: agent-development-rules 增加后端 Rust 文件复杂度章节

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 接入 `AGENTS.md` 与 `docs/README.md`（任务路由 + 门禁 + 索引）

**Files:**
- Modify: `AGENTS.md`（§3 目录地图补 `scripts/`、§4 任务路由加 Rust 行、§5 质量门禁加第 5 步）
- Modify: `docs/README.md`（架构与项目规范类索引加新文档；读取顺序表加「Rust 改动」行）

**Interfaces:**
- Consumes: Task 3 专项文档、Task 1 脚本、Task 4 通用规则章节。
- Produces: 完整三层闭环——Agent 改 Rust 时被 §4 路由到规范、被 §5 门禁强制执行。

- [ ] **Step 1: `AGENTS.md` §3 目录地图补 `scripts/` 说明**

用 Edit，`old_string`：

```
> 不得把领域逻辑塞进泛化 `utils`。
```

`new_string`：

```
> 不得把领域逻辑塞进泛化 `utils`。
>
> `scripts/`：仓库级脚本（构建、发版、`check-rust-file-size.sh` 单文件大小门禁等）。
```

- [ ] **Step 2: `AGENTS.md` §4 任务路由加「改动 Rust」行**

用 Edit，`old_string`：

```
- 改动 TypeScript / TSX / JavaScript：读取 `docs/standards/engineering-spec.md`、`docs/standards/coding-style.md`。
```

`new_string`：

```
- 改动 TypeScript / TSX / JavaScript：读取 `docs/standards/engineering-spec.md`、`docs/standards/coding-style.md`。
- 改动 Rust（`src-tauri/**/*.rs`）：读取 `docs/architecture-design/backend-large-file-splitting-rules.md`、`docs/architecture-design/agent-development-rules.md`「后端 Rust 文件复杂度」章节。
```

- [ ] **Step 3: `AGENTS.md` §5 质量门禁加第 5 步**

用 Edit，`old_string`：

```
4. `pnpm test` — 改了运行时行为 / 分支 / 数据流 / 渲染 / 测试依赖实现时必跑；纯类型或纯样式改动可豁免，但须在最终说明写明豁免理由。
```

`new_string`：

```
4. `pnpm test` — 改了运行时行为 / 分支 / 数据流 / 渲染 / 测试依赖实现时必跑；纯类型或纯样式改动可豁免，但须在最终说明写明豁免理由。
5. `bash scripts/check-rust-file-size.sh` — 改动 Rust（`src-tauri/**/*.rs`）后必跑；越界且未在 `scripts/rust-file-size-allowlist.txt` 登记则非零退出，须按 `docs/architecture-design/backend-large-file-splitting-rules.md` 拆分后再跑直至通过。纯前端 / 纯文档改动可豁免。
```

- [ ] **Step 4: `AGENTS.md` §5 完成判定补一句脚本产出**

用 Edit，`old_string`：

```
- 每一处 diff 可追溯到用户请求、项目文档或验证失败。
```

`new_string`：

```
- 每一处 diff 可追溯到用户请求、项目文档或验证失败。
- 改动 Rust 时，`scripts/check-rust-file-size.sh` 通过（越界文件已拆分或属白名单存量）。
```

- [ ] **Step 5: `docs/README.md` 架构与项目规范类索引加新文档**

用 Edit，`old_string`：

```
- [前端大型组件拆分规则](./architecture-design/frontend-large-component-splitting-rules.md)
```

`new_string`：

```
- [前端大型组件拆分规则](./architecture-design/frontend-large-component-splitting-rules.md)
- [后端 Rust 大文件拆分规则](./architecture-design/backend-large-file-splitting-rules.md)
```

- [ ] **Step 6: `docs/README.md` 读取顺序表加「Rust 改动」行**

用 Edit，`old_string`：

```
| TypeScript / TSX              | 工程规范、编码风格、[项目代码地图](./architecture-design/project-map.md)    | [测试策略](./testing/strategy.md)  |
```

`new_string`：

```
| TypeScript / TSX              | 工程规范、编码风格、[项目代码地图](./architecture-design/project-map.md)    | [测试策略](./testing/strategy.md)  |
| Rust（`src-tauri/**/*.rs`）   | [后端 Rust 大文件拆分规则](./architecture-design/backend-large-file-splitting-rules.md)、Agent 开发规则 | [项目代码地图](./architecture-design/project-map.md) |
```

- [ ] **Step 7: 复查文档内部引用一致**

Run:
```bash
rg -n "backend-large-file-splitting-rules|check-rust-file-size|rust-file-size-allowlist" AGENTS.md docs/README.md
```
Expected: 多处引用，路径与脚本名拼写一致。

Run:
```bash
rg -n "改动 Rust|后端 Rust 文件复杂度|第 5 步|check-rust-file-size" AGENTS.md
```
Expected: §3/§4/§5 三处改动均出现。

- [ ] **Step 8: 复查工作区并提交**

Run: `git status --short`
Expected: 仅 `AGENTS.md`、`docs/README.md` 两个改动文件，无额外带出。

```bash
git add AGENTS.md docs/README.md
git commit -m "docs: AGENTS.md 与 README 接入 Rust 单文件大小门禁与路由

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 端到端门禁演练与自审

**Files:** 无新增/改动；仅验证。

**Interfaces:** 依赖 Task 1–5 全部完成。

- [ ] **Step 1: 模拟「改动触及存量白名单文件」门禁通过**

Run:
```bash
# 不实际改业务代码：用 git 模式在无 Rust 改动时跑，应显示无改动且通过
bash scripts/check-rust-file-size.sh; echo "exit=$?"
```
Expected: 输出 `检查本次 git 改动触及的 Rust 文件:` 与 `(无 Rust 文件改动)`，`exit=0`。

- [ ] **Step 2: 模拟「改动触及非白名单文件越界」门禁阻断**

```bash
# 临时给一个未入白名单的小文件追加超阈值内容，演练阻断，演练后还原
f=src-tauri/src/local_data_path.rs
cp "$f" /tmp/ldp.bak
yes '//' | head -n 600 >> "$f"
bash scripts/check-rust-file-size.sh; echo "exit=$?"
cp /tmp/ldp.bak "$f"
rm /tmp/ldp.bak
git status --short
```
Expected: 脚本输出含 `[VIOLATION] src-tauri/src/local_data_path.rs: ... > 阈值 500`，`exit=1`；还原后 `git status --short` 干净（无残留）。

- [ ] **Step 3: 确认白名单覆盖度仍为空（防止本任务演练漏改）**

Run:
```bash
bash scripts/check-rust-file-size.sh --all --names-only
```
Expected: 输出为空。

- [ ] **Step 4: 确认工作区干净，所有任务已提交**

Run: `git status --short`
Expected: 无输出（所有改动已在 Task 1–5 提交）。

- [ ] **Step 5: 自审 plan 与交付一致性**

逐一确认：
- 脚本默认 git 模式只检查改动文件（Step 1/2 验证）。
- 白名单覆盖全部当前超阈值文件（Step 3 验证为空）。
- `AGENTS.md` §4 改 Rust 指向专项文档、§5 第 5 步调用脚本（Task 5 Step 2/3）。
- `docs/README.md` 索引与读取顺序表含新文档（Task 5 Step 5/6）。
- 无新增 `@ts-ignore`/`eslint-disable` 等（本计划不涉及 TS，自动满足）。

无新增提交（本任务仅验证）。
