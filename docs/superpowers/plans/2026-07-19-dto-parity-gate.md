# DTO Parity Gate 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Rust↔TypeScript 跨边界 DTO 的自动 parity 校验，让字段/变体漂移在测试期可见（红），并回写已 drift 的 `tauri-contract.md` 注册表。

**Architecture:** 双向 AST 解析 + 归一化签名对比。Rust 侧用 `syn`（dev-dep）解析 `src-tauri/src/types/*.rs`，导出 `{类型名 → {字段名: required|optional}}` 与 `{enum → 变体集}` 的 JSON 快照（提交进仓）。前端 vitest 用 `typescript` compiler API 解析 10 个 `*-commands.ts`，生成同款签名，按「类型名映射表」匹配后对比。零生产依赖。

**Tech Stack:** Rust 2021 + `syn 2`（dev-dependency）；TypeScript 5.8 + `typescript` compiler API（已在 devDependencies）+ Vitest 4。

## Global Constraints

- 不引入任何生产依赖：`syn` 仅进 `src-tauri/Cargo.toml` 的 `[dev-dependencies]`；前端不新增依赖（`typescript` 已在 devDependencies）。
- 所有新增/改动代码注释、测试描述、文档正文用简体中文（AGENTS.md §10）。
- 文件命名 kebab-case；Rust 字段命名遵循既有 `snake_case` + `#[serde(rename_all)]`；TS 沿用既有 camelCase interface。
- 不新增 `@ts-ignore` / `@ts-nocheck` / `any` / `eslint-disable` / 跳过测试（AGENTS.md §5、§7）。
- parity 范围限定「字段名集合 + 可选性 + enum 变体」三项；**不做类型 kind（number/string）细对齐**——前端 TS 原始类型粒度本就粗，且此项对齐复杂度高、收益低，超出 HTML 候选 4「字段漂移可见化」的核心诉求（YAGNI）。
- 每个 task 结束按 AGENTS.md §5 跑相关门禁：改 Rust 跑 `cd src-tauri && cargo test` + `bash scripts/check-rust-file-size.sh`；改前端跑 `pnpm format`/`lint`/`typecheck`/`test` + `bash scripts/check-frontend-file-size.sh`；改文档复查内部链接。

## 事实依据（为何做）

- `tauri-contract.md:17-25` Command 注册表 9 条路径中 8 条已不存在（ADR-0013 feature-first 重构后命令下沉到 `features/<feature>/commands.rs`，`src-tauri/src/commands/` 实际只剩 `core_commands.rs` + `mod.rs`）。contract.md 是活文档（第 3 行自述「导航和变更清单」），ADR-0013:24「core/ 路径不回写」只针对历史 ADR，不适用于本表 → 理应回写。
- DTO 字段 drift 已抽样证实：Rust `ProjectSummary` ↔ TS `ProjectRecord` 类型名不同；`worktreeLocation`/`worktreeSetupCommand` Rust 必填、TS 可选；`codeWorkspaces` Rust 具名 `Vec<CodeWorkspaceRoot>`、TS 内联匿名结构。
- 规模：`src-tauri/src/types/` 21 文件 205 个 pub struct/enum；前端 10 个 `*-commands.ts` 约 200 个 export interface/type。已超手工维护边界。

## File Structure

新增：
- `src-tauri/tests/dto_parity_export.rs` — Rust 侧 DTO 签名导出器（syn 解析 types/*.rs → 写 JSON 快照）。
- `src/shared/commands/__parity__/rust-dto-signatures.json` — Rust 导出的签名快照（提交进仓，parity 对比的事实源）。
- `src/shared/commands/__parity__/dto-parity.test.ts` — 前端 vitest，解析 `*-commands.ts` 并对比 Rust 快照。
- `src/shared/commands/__parity__/extract-ts-signatures.ts` — TS compiler API 解析器，提取 interface/type 签名。
- `src/shared/commands/__parity__/name-mapping.ts` — Rust 类型名 → TS interface 名映射 + 前端独有类型白名单。
- `src/shared/commands/__parity__/rename.ts` — serde rename_all 算法（camelCase / snake_case / SCREAMING_SNAKE_CASE）的 TS 实现，供测试侧复用。

修改：
- `docs/architecture-design/tauri-contract.md` — 回写 Command/Event 注册表真实路径。
- `src-tauri/Cargo.toml` — 加 `syn` dev-dependency。
- `package.json` — 加 `test:parity` script（可选，见 Task 6）。
- 若干 `*-commands.ts` — 删除被 parity 取代的冗余「与后端对齐」注释（Task 5）。
- `docs/standards/engineering-spec.md` 或 AGENTS.md §5 — 登记新门禁（Task 6）。

---

### Task 1：回写 tauri-contract.md 注册表真实路径

零分歧、低风险先行项。纯文档改动，§5 文档豁免 lint/typecheck/test，但须复查内部链接。

**Files:**
- Modify: `docs/architecture-design/tauri-contract.md:15-38`

**Interfaces:** 无（文档）。

- [ ] **Step 1：核对 Command 注册表真实路径**

用 `lib.rs` 的 `generate_handler!`（已调研，约 80 个命令）与命令文件实际位置（`src-tauri/src/features/<feature>/commands.rs`、`session_monitor_commands.rs`、`workspace_commands.rs`、`commands/core_commands.rs`、`features/settings/agent_skill_commands.rs`）为权威，重写第 15-27 行表格的「Rust adapter」列：

| 分组 | Rust adapter（新） |
| --- | --- |
| 初始化 `initialize_local_data` | `commands/core_commands.rs` |
| 项目 | `features/project/commands.rs` |
| Issue | `features/issue/commands.rs` |
| 会话 | `features/agent_session/commands.rs` |
| 工作区查看 | `features/agent_session/workspace_commands.rs` |
| 项目终端 | `features/project_terminal/commands.rs` |
| Settings | `features/settings/commands.rs` |
| Skill 索引 | `features/settings/agent_skill_commands.rs` |
| 会话监控窗口 | `features/agent_session/session_monitor_commands.rs` |

- [ ] **Step 2：核对 Event 注册表生产者路径**

第 31-36 行表格的「生产者」列：`agent_event_broadcaster.rs`、`agent_skill_commands.rs`、`session_monitor_commands.rs` 实际位置是否仍准确。用 `grep -rn "app_handle.emit\|emit_to\|\.emit(" src-tauri/src/` 核对每个事件的真实生产者文件路径并更新。

- [ ] **Step 3：补一行脚注说明回写依据**

在第 27 行「新增 command 必须同时更新…」段落后追加一句：

> 注册表路径以 `src-tauri/src/lib.rs` 的 `generate_handler!` 与各 feature 的 `commands.rs` 为准；ADR-0013 feature-first 重构后命令已下沉到 `features/<feature>/`，本表随之回写。

- [ ] **Step 4：复查内部链接与引用一致性**

Run: `rg -n "commands/.*_commands\.rs|tauri-contract" docs/`
Expected: 无断链；contract.md 自引用的 ADR 编号正确。

- [ ] **Step 5：commit**

```bash
git add docs/architecture-design/tauri-contract.md
git commit -m "docs: 回写 tauri-contract 注册表为 feature-first 真实路径

ADR-0013 后命令下沉到 features/<feature>/commands.rs，contract.md
仍引用旧 commands/xxx_commands.rs 路径（9 条中 8 条已不存在）。
contract.md 是活文档（非历史 ADR），按 ADR-0013:24 例外回写。
Refs: 架构评审候选 4"
```

---

### Task 2：Rust DTO 签名导出器 + 快照（机制）

用 `syn` 解析 `src-tauri/src/types/*.rs`，导出归一化签名 JSON。本 task 建立「机制」并跑通全量 types/。

**Files:**
- Create: `src-tauri/tests/dto_parity_export.rs`
- Modify: `src-tauri/Cargo.toml`（加 `syn` dev-dep）
- Create(generated, commit): `src/shared/commands/__parity__/rust-dto-signatures.json`

**Interfaces:**
- Produces: `rust-dto-signatures.json`，schema：
```json
{
  "structs": {
    "<RustStructName>": {
      "fields": { "<camelCaseFieldName>": "required" | "optional" }
    }
  },
  "enums": {
    "<RustEnumName>": {
      "rename": "camelCase" | "snake_case" | "SCREAMING_SNAKE_CASE",
      "variants": ["<serialized variant string>"]
    }
  }
}
```
- 规则：字段名按 struct 的 `#[serde(rename_all = "camelCase")]` 转 camelCase 后输出；`Option<T>` 或带 `#[serde(default)]` 的字段记 `optional`，否则 `required`；`#[serde(skip)]` / `skip_serializing` / `skip_deserializing` 字段排除。enum 变体按 enum 的 `rename_all` 输出序列化字符串。

- [ ] **Step 1：加 syn dev-dependency**

Modify `src-tauri/Cargo.toml` `[dev-dependencies]`：
```toml
[dev-dependencies]
tempfile = "3.23.0"
syn = { version = "2", features = ["full", "extra-traits"] }
```

Run: `cd src-tauri && cargo fetch`
Expected: 成功拉取 syn 2。

- [ ] **Step 2：写失败测试——断言导出器产出关键字段**

Create `src-tauri/tests/dto_parity_export.rs`，先写最小测试驱动实现：

```rust
//! DTO parity 导出器：解析 src/types/*.rs，导出归一化签名 JSON。
//! 由 dto-parity 前端测试消费。零生产依赖（syn 仅 dev-dep）。

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use syn::{Item, ItemEnum, ItemStruct};

/// 归一化签名（序列化为 rust-dto-signatures.json）。
#[derive(serde::Serialize)]
struct DtoSignatures {
    structs: BTreeMap<String, StructSig>,
    enums: BTreeMap<String, EnumSig>,
}

#[derive(serde::Serialize)]
struct StructSig {
    fields: BTreeMap<String, FieldOptionality>,
}

#[derive(serde::Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum FieldOptionality {
    Required,
    Optional,
}

#[derive(serde::Serialize)]
struct EnumSig {
    rename: String,
    variants: Vec<String>,
}

// --- serde 属性解析（rename_all / per-field rename / default / skip / Option）---

/// 从 struct/enum 的 `#[serde(...)]` 属性取 `rename_all` 值。
fn extract_rename_all(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let nested = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
        );
        if let Ok(metas) = nested {
            for meta in metas {
                if let syn::Meta::NameValue(nv) = meta {
                    if nv.path.is_ident("rename_all") {
                        if let syn::Expr::Lit(syn::ExprLit {
                            lit: syn::Lit::Str(s),
                            ..
                        }) = nv.value
                        {
                            return Some(s.value());
                        }
                    }
                }
            }
        }
    }
    None
}

/// 字段是否被 serde skip（不跨边界）。
fn is_skipped(attrs: &[syn::Attribute]) -> bool {
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("skip")
                || meta.path.is_ident("skip_serializing")
                || meta.path.is_ident("skip_deserializing")
            {
                return Err(meta.error("skip"));
            }
            Ok(())
        });
        // parse_nested_meta 遇 skip 返回 Err，视为命中
        if attr.meta.requires_inherent() {
            // 占位防止未使用警告；实际判断见下
        }
    }
    false
}
// 上面 is_skipped 用 parse_nested_meta 的 Err 路径不够直观，实现时改用：
// 遍历 nested meta，遇到 skip/skip_serializing/skip_deserializing 即返回 true。
// （执行时按此修正，删除占位分支。）

fn field_has_default(attrs: &[syn::Attribute]) -> bool {
    let mut hit = false;
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("default") {
                hit = true;
            }
            Ok(())
        });
    }
    hit
}

fn is_option(ty: &syn::Type) -> bool {
    let syn::Type::Path(tp) = ty else { return false; };
    tp.path.segments.last().map(|s| s.ident == "Option").unwrap_or(false)
}

// --- rename_all 文本转换 ---

fn to_camel_case(snake: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for (i, ch) in snake.chars().enumerate() {
        if ch == '_' {
            upper = true;
        } else if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else if i == 0 {
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn pascal_to_snake(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() && i != 0 {
            out.push('_');
        }
        out.extend(ch.to_lowercase());
    }
    out
}

fn apply_enum_rename(variant_ident: &str, rename_all: &str) -> String {
    match rename_all {
        "snake_case" => pascal_to_snake(variant_ident),
        "SCREAMING_SNAKE_CASE" => pascal_to_snake(variant_ident).to_uppercase(),
        "camelCase" => {
            let s = pascal_to_snake(variant_ident);
            to_camel_case(&s)
        }
        _ => variant_ident.to_string(),
    }
}

// --- 主解析 ---

fn parse_struct(item: &ItemStruct) -> Option<(String, StructSig)> {
    // 仅处理 pub struct 且带 Serialize 或 Deserialize derive（跨边界）
    let derives_serde = item.attrs.iter().any(|a| {
        a.meta.path().is_ident("derive")
            && a.to_token_stream().to_string().replace(' ', "").contains("Serialize")
    });
    if !derives_serde {
        return None;
    }
    let rename_all = extract_rename_all(&item.attrs);
    let mut fields: BTreeMap<String, FieldOptionality> = BTreeMap::new();
    if let syn::Fields::Named(named) = &item.fields {
        for f in &named.named {
            if is_skipped(&f.attrs) {
                continue;
            }
            // per-field #[serde(rename = "...")] 优先
            let raw = f.ident.as_ref().unwrap().to_string();
            let name = field_rename(&f.attrs).unwrap_or_else(|| {
                match rename_all.as_deref() {
                    Some("camelCase") => to_camel_case(&raw),
                    _ => raw,
                }
            });
            let optional = is_option(&f.ty) || field_has_default(&f.attrs);
            fields.insert(
                name,
                if optional { FieldOptionality::Optional } else { FieldOptionality::Required },
            );
        }
    }
    Some((item.ident.to_string(), StructSig { fields }))
}

fn field_rename(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let mut out: Option<String> = None;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename") {
                let value = meta.value()?;
                let s: syn::LitStr = value.parse()?;
                out = Some(s.value());
            }
            Ok(())
        });
        if out.is_some() {
            return out;
        }
    }
    None
}

fn parse_enum(item: &ItemEnum) -> Option<(String, EnumSig)> {
    let derives_serde = item.attrs.iter().any(|a| {
        a.meta.path().is_ident("derive")
            && a.to_token_stream().to_string().replace(' ', "").contains("Serialize")
    });
    if !derives_serde {
        return None;
    }
    let rename_all = extract_rename_all(&item.attrs).unwrap_or_else(|| "camelCase".into());
    let variants = item
        .variants
        .iter()
        .map(|v| apply_enum_rename(&v.ident.to_string(), &rename_all))
        .collect();
    Some((item.ident.to_string(), EnumSig { rename: rename_all, variants }))
}

fn collect_signatures() -> DtoSignatures {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/types");
    let mut structs = BTreeMap::new();
    let mut enums = BTreeMap::new();
    for entry in fs::read_dir(&dir).expect("read types dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|s| s.to_str()) != Some("rs") {
            continue;
        }
        let src = fs::read_to_string(&path).expect("read type file");
        let file = syn::parse_file(&src).expect("parse file");
        for item in file.items {
            match item {
                Item::Struct(s) => {
                    if let Some((name, sig)) = parse_struct(&s) {
                        structs.insert(name, sig);
                    }
                }
                Item::Enum(e) => {
                    if let Some((name, sig)) = parse_enum(&e) {
                        enums.insert(name, sig);
                    }
                }
                _ => {}
            }
        }
    }
    DtoSignatures { structs, enums }
}

#[test]
fn export_dto_signatures_writes_snapshot() {
    let sigs = collect_signatures();
    // 关键类型存在性断言（驱动实现正确）
    let project = sigs.structs.get("ProjectSummary").expect("ProjectSummary 存在");
    assert_eq!(project.fields.get("id"), Some(&FieldOptionality::Required));
    assert_eq!(project.fields.get("codeWorkspaces"), Some(&FieldOptionality::Required));
    assert!(sigs.enums.contains_key("ProjectWorktreeLocation"));
    assert!(sigs.enums.contains_key("CommandErrorCode"));

    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/shared/commands/__parity__/rust-dto-signatures.json");
    fs::create_dir_all(out.parent().unwrap()).unwrap();
    let json = serde_json::to_string_pretty(&sigs).unwrap();
    fs::write(&out, json).unwrap();
}
```

> **实现注意（执行时修正占位）：** 上面 `is_skipped` 含一段标记为「占位」的不精确实现。执行时改为：用 `attr.parse_nested_meta`，meta 回调里若 `meta.path.is_ident("skip"/"skip_serializing"/"skip_deserializing")` 则置 `hit=true` 并返回 `Ok(())`，函数末尾返回 `hit`。删除 `_ = attr.meta.requires_inherent()` 那段伪代码。需 `use syn::Token;` 或用 `parse_nested_meta` 不需 Token。补 `use quote::ToTokens;`（已在 syn features 里，需确认 `quote` 可用；若不可用，derive 检测改用 `attr.path().is_ident("derive")` 后 `meta.require_list().parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated)` 检查每项 `path.is_ident("Serialize")`，不依赖 ToTokens）。

- [ ] **Step 3：运行测试，确认失败（红）**

Run: `cd src-tauri && cargo test --test dto_parity_export`
Expected: 编译错误或断言失败（`ProjectSummary` 未找到 / 字段名不符）。若 syn feature 缺失则补 features。

- [ ] **Step 4：修正实现至测试通过（绿）**

按 Step 2 的「实现注意」修正 `is_skipped`、derive 检测。重跑直到：
Run: `cd src-tauri && cargo test --test dto_parity_export`
Expected: PASS，且 `src/shared/commands/__parity__/rust-dto-signatures.json` 生成。

- [ ] **Step 5：人工抽检快照内容**

打开 `rust-dto-signatures.json`，确认：
- `structs.ProjectSummary.fields` 含 `id`/`name`/`repoPath`/`worktreeLocation`/`worktreeSetupCommand`/`createdAt`/`lastOpenedAt`/`codeWorkspaces`，全 `required`。
- `enums.ProjectWorktreeLocation.variants` = `["repo_sibling","repo_internal","user_home"]`，rename = `snake_case`。
- `enums.CommandErrorCode.variants` 含 `SCREAMING_SNAKE_CASE` 形如 `LOCAL_DATA_INITIALIZATION_FAILED`，rename = `SCREAMING_SNAKE_CASE`。
- `CommandError` 结构含 `code`/`message` required，`reason`/`details` optional。

- [ ] **Step 6：跑 Rust 门禁**

Run: `cd src-tauri && cargo test`
Expected: 全绿（含预存的 agent_session/settings 测试，见 memory 记录）。
Run: `cd /Users/yujianjia/workspace/kafka/redwhisk.worktrees/issue-123 && bash scripts/check-rust-file-size.sh`
Expected: 通过（新测试文件应 < 500 行；若超限按 backend-large-file-splitting-rules 拆，或拆出 `rename.rs` 辅助）。

- [ ] **Step 7：commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tests/dto_parity_export.rs \
        src/shared/commands/__parity__/rust-dto-signatures.json
git commit -m "feat: 新增 Rust DTO 签名导出器与快照

用 syn(dev-dep) 解析 src/types/*.rs，导出字段名+可选性与 enum 变体
签名 JSON，供前端 parity 测试对比。零生产依赖。
Refs: 架构评审候选 4"
```

---

### Task 3：TS 签名提取器 + parity 对比测试（机制，project 域跑通）

建立前端侧解析与对比机制，先用 project 域验证打通，再在 Task 4 全量纳入。

**Files:**
- Create: `src/shared/commands/__parity__/rename.ts`
- Create: `src/shared/commands/__parity__/extract-ts-signatures.ts`
- Create: `src/shared/commands/__parity__/name-mapping.ts`
- Create: `src/shared/commands/__parity__/dto-parity.test.ts`

**Interfaces:**
- Consumes: `rust-dto-signatures.json`（Task 2 产出）。
- Produces: `dto-parity.test.ts`（vitest），断言「Rust 每个跨边界类型在 TS 侧有对应 interface，字段集合与可选性一致；enum 变体一致」。

- [ ] **Step 1：写 rename.ts（serde rename_all 的 TS 实现）**

Create `src/shared/commands/__parity__/rename.ts`：

```typescript
/** serde rename_all 规则的 TS 实现，与 Rust 侧 dto_parity_export.rs 对齐。 */

export function toCamelCase(snake: string): string {
  let out = "";
  let upper = false;
  for (let i = 0; i < snake.length; i += 1) {
    const ch = snake[i];
    if (ch === "_") {
      upper = true;
    } else if (upper) {
      out += ch.toUpperCase();
      upper = false;
    } else if (i === 0) {
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}

export function pascalToSnake(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i += 1) {
    const ch = name[i];
    if (ch >= "A" && ch <= "Z" && i !== 0) {
      out += "_";
    }
    out += ch.toLowerCase();
  }
  return out;
}

export function applyEnumRename(variantIdent: string, renameAll: string): string {
  switch (renameAll) {
    case "snake_case":
      return pascalToSnake(variantIdent);
    case "SCREAMING_SNAKE_CASE":
      return pascalToSnake(variantIdent).toUpperCase();
    case "camelCase": {
      const snake = pascalToSnake(variantIdent);
      return toCamelCase(snake);
    }
    default:
      return variantIdent;
  }
}
```

- [ ] **Step 2：写 extract-ts-signatures.ts（typescript compiler API 解析）**

Create `src/shared/commands/__parity__/extract-ts-signatures.ts`：

```typescript
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface TsStructSig {
  fields: Record<string, "required" | "optional">;
}
export interface TsEnumSig {
  variants: string[];
}
export interface TsSignatures {
  structs: Record<string, TsStructSig>;
  enums: Record<string, TsEnumSig>;
}

/** 递归收集 interface 的字段（含继承的 extends）。 */
function collectInterfaceFields(
  node: ts.InterfaceDeclaration,
  checker: ts.TypeChecker,
): Record<string, "required" | "optional"> {
  const fields: Record<string, "required" | "optional"> = {};
  const type = checker.getTypeAtLocation(node.name);
  for (const prop of type.getProperties()) {
    const decl = prop.valueDeclaration as ts.PropertySignature | undefined;
    const optional = decl?.questionToken !== undefined ? "optional" : "required";
    fields[prop.name] = optional;
  }
  return fields;
}

/** union 字面量类型（如 "a" | "b"）的变体。 */
function collectUnionVariants(node: ts.TypeAliasDeclaration): string[] | null {
  if (!node.type || !ts.isUnionTypeNode(node.type)) {
    return null;
  }
  return node.type.types
    .map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : null))
    .filter((v): v is string => v !== null);
}

export function extractTsSignatures(filePath: string): TsSignatures {
  const structs: Record<string, TsStructSig> = {};
  const enums: Record<string, TsEnumSig> = {};
  const src = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram({
    rootNames: [filePath],
    options: { noEmit: true, strict: true },
  });
  const checker = program.getTypeChecker();

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node)) {
      structs[node.name.text] = { fields: collectInterfaceFields(node, checker) };
    } else if (ts.isTypeAliasDeclaration(node)) {
      const variants = collectUnionVariants(node);
      if (variants) {
        enums[node.name.text] = { variants };
      }
      // 别名指向 interface 的（export type Foo = { ... }）按字面量结构解析
      if (node.type && ts.isTypeLiteralNode(node.type)) {
        const fields: Record<string, "required" | "optional"> = {};
        for (const m of node.type.members) {
          if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) {
            fields[m.name.text] = m.questionToken ? "optional" : "required";
          }
        }
        structs[node.name.text] = { fields };
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { structs, enums };
}

/** 扫描多个 commands.ts 汇总。 */
export function extractAllTsSignatures(files: string[]): TsSignatures {
  const structs: Record<string, TsStructSig> = {};
  const enums: Record<string, TsEnumSig> = {};
  for (const f of files) {
    const sig = extractTsSignatures(f);
    Object.assign(structs, sig.structs);
    Object.assign(enums, sig.enums);
  }
  return { structs, enums };
}
```

- [ ] **Step 3：写 name-mapping.ts（Rust→TS 名映射 + 白名单）**

Create `src/shared/commands/__parity__/name-mapping.ts`（初始只放已知的名字差异，Task 4 扩充）：

```typescript
/**
 * Rust 类型名 → TS interface 名映射。
 * 仅登记「名字不同但契约对应」的对；未登记的 Rust 类型要求 TS 侧存在同名 interface。
 */
export const rustToTsName: Record<string, string> = {
  // 例：ProjectSummary ↔ ProjectRecord（Rust 用 Summary，前端历史用 Record）
  ProjectSummary: "ProjectRecord",
};

/**
 * Rust 侧存在、但前端不需要 mirror 的类型白名单（内部辅助 / 非跨边界 / 仅 Rust 内部消费）。
 * 初始为空，Task 4 根据首次对比结果登记。
 */
export const rustOnlyAllowlist: ReadonlySet<string> = new Set<string>([]);
```

- [ ] **Step 4：写失败测试——project 域 parity**

Create `src/shared/commands/__parity__/dto-parity.test.ts`：

```typescript
import path from "node:path";
import { describe, expect, it } from "vitest";
import rustRaw from "./rust-dto-signatures.json";
import { extractAllTsSignatures } from "./extract-ts-signatures";
import { rustToTsName, rustOnlyAllowlist } from "./name-mapping";

interface RustSig {
  structs: Record<string, { fields: Record<string, "required" | "optional"> }>;
  enums: Record<string, { rename: string; variants: string[] }>;
}

const rust = rustRaw as RustSig;
const commandsDir = path.resolve(__dirname, "../../..");
const tsFiles = [
  path.join(commandsDir, "features/project/project-commands.ts"),
];

const ts = extractAllTsSignatures(tsFiles);

function tsNameFor(rustName: string): string {
  return rustToTsName[rustName] ?? rustName;
}

describe("DTO parity（project 域）", () => {
  it("Rust 每个跨边界 struct 在 TS 侧有对应 interface 且字段一致", () => {
    const mismatches: string[] = [];
    for (const [rustName, rustSig] of Object.entries(rust.structs)) {
      if (rustOnlyAllowlist.has(rustName)) continue;
      const tsName = tsNameFor(rustName);
      const tsSig = ts.structs[tsName];
      // project 域 task：仅校验映射到 project-commands.ts 的类型，其余 skip（Task 4 全量）
      const isProjectDomain = ["ProjectSummary", "CreateProjectInput", "OpenProjectInput",
        "UpdateProjectSettingsInput", "ValidateProjectRepoPathInput",
        "ValidateProjectRepoPathResponse", "ProjectListResponse", "ProjectListItem",
        "OpenProjectWindowResponse"].includes(rustName);
      if (!isProjectDomain) continue;
      if (!tsSig) {
        mismatches.push(`${rustName}: TS 侧缺少 interface ${tsName}`);
        continue;
      }
      const tsFields = Object.keys(tsSig.fields);
      for (const [field, opt] of Object.entries(rustSig.fields)) {
        const tsOpt = tsSig.fields[field];
        if (tsOpt === undefined) {
          mismatches.push(`${rustName}.${field}: TS 缺少字段`);
        } else if (tsOpt !== opt) {
          mismatches.push(`${rustName}.${field}: 可选性 Rust=${opt} TS=${tsOpt}`);
        }
      }
      for (const f of tsFields) {
        if (rustSig.fields[f] === undefined) {
          mismatches.push(`${rustName}: TS 多出字段 ${f}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("Rust 跨边界 enum 变体与 TS 一致", () => {
    const mismatches: string[] = [];
    for (const [rustName, rustSig] of Object.entries(rust.enums)) {
      if (rustOnlyAllowlist.has(rustName)) continue;
      const tsName = tsNameFor(rustName);
      const tsSig = ts.enums[tsName];
      const isProjectDomain = ["ProjectWorktreeLocation", "ProjectPathStatus"].includes(rustName);
      if (!isProjectDomain) continue;
      if (!tsSig) {
        mismatches.push(`${rustName}: TS 缺少 union ${tsName}`);
        continue;
      }
      const rustSet = new Set(rustSig.variants);
      const tsSet = new Set(tsSig.variants);
      for (const v of rustSet) if (!tsSet.has(v)) mismatches.push(`${rustName}: TS 缺少变体 ${v}`);
      for (const v of tsSet) if (!rustSet.has(v)) mismatches.push(`${rustName}: TS 多出变体 ${v}`);
    }
    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 5：跑测试，确认 parity 在已知 drift 上失败（红）**

Run: `pnpm test src/shared/commands/__parity__/dto-parity.test.ts`
Expected: FAIL，报告 `ProjectSummary` ↔ `ProjectRecord` 的字段差异（如 `worktreeLocation` 可选性、TS `codeWorkspaces` 嵌套结构）。**这正面证明 gate 能抓 drift。**

- [ ] **Step 6：判定每个 mismatch 是「真 drift 需修」还是「合法差异需登记」**

逐条核对 project 域 mismatch。判定 protocol：
- 若 Rust 是契约权威且 TS 与运行时行为一致 → TS 字段可选性/结构应改为与 Rust 一致（**修 TS**）。
- 若 TS 实际依赖可选性（如 `ProjectRecord.worktreeLocation?` 被消费方依赖）→ 这是 Rust 应放宽还是 TS 应收紧需读消费方判断；若运行时两者都成立，登记进 `rustToTsName` 或在测试中标注例外。
- 记录每个判定到本 plan 的执行日志（commit message 或 .scratch 笔记）。

> 已知预期 drift（Task 4 前不修，留作 gate 首批证据）：`ProjectSummary`↔`ProjectRecord` 名字差异已在 `rustToTsName` 登记可选性差异需在此 step 判定。

- [ ] **Step 7：修复或登记 project 域 mismatch 至测试通过（绿）**

按 Step 6 判定修 TS 或补 name-mapping/allowlist。重跑：
Run: `pnpm test src/shared/commands/__parity__/dto-parity.test.ts`
Expected: PASS。

- [ ] **Step 8：跑前端门禁**

Run: `pnpm format` → 复查 `git status --short`（按 memory `pnpm-format-unrelated-files`，tauri.conf.json/pnpm-lock.yaml 的无关改写须回退）。
Run: `pnpm lint`、`pnpm typecheck`
Expected: 通过（JSON import 需 `resolveJsonModule`，确认 tsconfig 已开启；未开启则在 tsconfig.json 的 `compilerOptions` 加 `"resolveJsonModule": true` 并说明）。
Run: `bash scripts/check-frontend-file-size.sh`
Expected: 通过。

- [ ] **Step 9：commit**

```bash
git add src/shared/commands/__parity__/ src/tsconfig*.json
git commit -m "feat: 新增前端 DTO parity 测试（project 域）

用 typescript compiler API 解析 *-commands.ts，对比 Rust 签名快照。
project 域跑通并修复 ProjectSummary/ProjectRecord 等已知 drift。
Refs: 架构评审候选 4"
```

---

### Task 4：全量纳入 + 消化初始 diff

把 10 个 `*-commands.ts` 全纳入 parity，扩充 name-mapping 与 allowlist，逐域消化首次对比的全部 mismatch。**这是不确定性最高的 task**：首次全量对比的 mismatch 数量未知，可能需多轮「跑测试 → 判定 → 修/登记」。

**Files:**
- Modify: `src/shared/commands/__parity__/dto-parity.test.ts`（移除 project 域白名单，改为全量）
- Modify: `src/shared/commands/__parity__/name-mapping.ts`（扩充映射 + allowlist）
- Possibly Modify: 若干 `*-commands.ts`（修真 drift）、`src-tauri/src/types/*.rs`（若判定 Rust 才是错的——罕见，需证据）

**Interfaces:** 复用 Task 2/3。

- [ ] **Step 1：扩 tsFiles 到全部 10 个 commands.ts**

Modify `dto-parity.test.ts` 的 `tsFiles`：
```typescript
const tsFiles = [
  path.join(commandsDir, "features/project/project-commands.ts"),
  path.join(commandsDir, "features/issues/issue-commands.ts"),
  path.join(commandsDir, "features/agents/agent-session-commands.ts"),
  path.join(commandsDir, "features/agents/session-workspace/session-workspace-commands.ts"),
  path.join(commandsDir, "features/agents/session-notifications/session-monitor-commands.ts"),
  path.join(commandsDir, "features/terminals/project-terminal-commands.ts"),
  path.join(commandsDir, "features/settings/settings-commands.ts"),
  path.join(commandsDir, "shared/commands/app-commands.ts"),
  path.join(commandsDir, "shared/commands/app-update-commands.ts"),
  path.join(commandsDir, "shared/workspace/workspace-commands.ts"),
];
```
并删除 `isProjectDomain` 过滤，改为全量遍历（保留 `rustOnlyAllowlist` 跳过机制）。

- [ ] **Step 2：跑全量测试，收集 mismatch 清单**

Run: `pnpm test src/shared/commands/__parity__/dto-parity.test.ts`
Expected: FAIL，输出完整 mismatch 列表。把列表导出到 `.scratch/parity-initial-diff.md`（按 issue-tracker skill 的 `.scratch/` 惯例，非提交物）。

- [ ] **Step 3：逐条判定 mismatch（drift triage protocol）**

对每条 mismatch，按下表判定并记录到 `.scratch/parity-initial-diff.md`：

| 判定 | 处理 | 例子 |
| --- | --- | --- |
| Rust 改了/TS 漏了，TS 应跟 | 修 TS interface | 字段缺失、可选性应收紧 |
| TS 名字与 Rust 不同但契约一致 | 登记进 `rustToTsName` | `ProjectSummary`↔`ProjectRecord` |
| Rust 侧内部类型，前端不该 mirror | 登记进 `rustOnlyAllowlist` + 注释说明 | 仅 Rust service 内部消费的辅助 struct |
| TS 独有辅助类型（Rust 无对应） | 测试只校验「Rust 有→TS 须有」方向，TS 多出不报错（天然忽略） | 前端组合用的 Pick/Omit 派生类型 |
| enum 变体 Rust 有 TS 无（或反之） | 修 TS union 与 Rust 对齐 | 状态机新增状态 TS 漏 |

> **判定纪律（AGENTS.md §6）：** 每条 drift 修复须可追溯到运行时行为；不为了「让测试绿」而草率登记 allowlist。真 drift 必修，合法差异才登记。allowlist 每条带注释说明为何前端不需 mirror。

- [ ] **Step 4：分轮修复 + 登记，每轮 commit 一次**

按域分批（建议顺序：issue → agent_session → terminal → session_workspace → settings → app/app_update/workspace → errors）。每域：
1. 修 TS drift 或补 name-mapping/allowlist。
2. `pnpm test src/shared/commands/__parity__/dto-parity.test.ts` 看该域转绿。
3. `pnpm format && pnpm lint && pnpm typecheck`。
4. commit：`fix(parity): 消化 <域> 域 DTO drift`。

- [ ] **Step 5：全量测试转绿**

Run: `pnpm test src/shared/commands/__parity__/dto-parity.test.ts`
Expected: PASS（mismatch 清单为空）。

- [ ] **Step 6：跑完整前端门禁 + Rust 门禁**

Run: `pnpm format`（复查 git status）、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`bash scripts/check-frontend-file-size.sh`。
Run: `cd src-tauri && cargo test`（若 Task 4 改了 Rust types）。
Expected: 全绿。预存失败项按 memory 记录判断（agent_session 3 PTY 已修；settings label 重复校验预存）。

- [ ] **Step 7：清理 .scratch 笔记**

Run: `rm .scratch/parity-initial-diff.md`（若已提交则跳过；保持工作区干净，AGENTS.md §8）。

---

### Task 5：清理被 parity 取代的冗余「与后端对齐」注释

parity gate 建立后，纯「DTO 字段对齐」类注释已无信息价值（gate 自动保证），可删。**保留有额外语义的注释**（行为对齐、事件名常量等不算 DTO mirror）。

**Files:**
- Modify: 若干 `*-commands.ts`（仅删 DTO mirror 类注释）

- [ ] **Step 1：复查候选注释**

Run: `rg -n "与后端|后端对齐|后端一致|keep in sync|manually mirror" src/ --glob "*-commands.ts"`
逐条判定：
- `issue-commands.ts:289`「完成流程 phase（与后端 IssueCompletionPhase 对应）」→ 若 parity 已覆盖该 enum 变体，注释冗余，删；但若注释还解释 phase 语义，保留语义部分删「与后端对应」字样。
- 行为/策略对齐类（如 message-stream-reducer.ts 的广播策略、agent-stream-events.ts 的事件名常量）**不是 DTO mirror，保留**。

- [ ] **Step 2：删除判定为冗余的注释**

只动判定为「纯 DTO 字段 mirror 声明」的注释行。不顺手改无关代码（AGENTS.md §6）。

- [ ] **Step 3：门禁**

Run: `pnpm format`（复查 git status）、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`bash scripts/check-frontend-file-size.sh`。
Expected: 全绿。

- [ ] **Step 4：commit**

```bash
git add <改动的 commands.ts>
git commit -m "refactor: 删除被 parity gate 取代的冗余 DTO 对齐注释"
```

---

### Task 6：parity gate 接入质量门禁

让 parity 成为 DTO 改动的常规验证项，并在文档登记。

**Files:**
- Modify: `package.json`（加 `test:parity` script，可选）
- Modify: `docs/architecture-design/tauri-contract.md`（加一节「parity gate」）
- Modify: `docs/standards/engineering-spec.md` 或 AGENTS.md §5（登记门禁项）

- [ ] **Step 1：加 npm script（可选，便于单独跑）**

Modify `package.json` `scripts`：
```json
"test:parity": "vitest run src/shared/commands/__parity__"
```
> 注意：parity 测试依赖 `rust-dto-signatures.json`。若 Rust types 改了须先 `cd src-tauri && cargo test --test dto_parity_export` 重新生成快照并 commit。在 contract.md 注明此依赖。

- [ ] **Step 2：在 tauri-contract.md 加「parity gate」小节**

在第 27 行后追加：

> ## Parity gate
>
> `src-tauri/tests/dto_parity_export.rs`（`cargo test`）解析 `src/types/*.rs` 生成 `src/shared/commands/__parity__/rust-dto-signatures.json`（提交进仓）；`src/shared/commands/__parity__/dto-parity.test.ts`（`pnpm test:parity`）解析全部 `*-commands.ts` 并对比。改 Rust DTO 后须重生成快照并 commit；改前端 `*-commands.ts` 后 `pnpm test` 自动校验。drift 表现为测试失败。类型名差异登记在 `name-mapping.ts`，前端不需 mirror 的 Rust 类型登记在 `rustOnlyAllowlist`（每条带注释说明）。

- [ ] **Step 3：在质量门禁文档登记**

在 `docs/standards/engineering-spec.md` 的跨边界 DTO 小节（或 AGENTS.md §5 注脚）补一句：改动 `src-tauri/src/types/*.rs` 或 `*-commands.ts` 后，须确保 `cargo test --test dto_parity_export` + `pnpm test:parity` 通过（前者重生成快照，后者校验 parity）。

> **不改 AGENTS.md §5 命令表本身**（避免每次 DTO 改动强制全量 cargo test + pnpm test 之外的额外硬门禁，保持最小）；改为在 engineering-spec 说明 + contract.md 自包含。

- [ ] **Step 4：复查文档链接**

Run: `rg -n "rust-dto-signatures|dto-parity|test:parity|parity gate" docs/`
Expected: 引用一致。

- [ ] **Step 5：最终全量门禁**

Run: `pnpm format`（复查 git status）、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`bash scripts/check-frontend-file-size.sh`、`cd src-tauri && cargo test`、`bash scripts/check-rust-file-size.sh`。
Expected: 全绿（预存失败项按 memory 记录说明）。

- [ ] **Step 6：commit**

```bash
git add package.json docs/architecture-design/tauri-contract.md docs/standards/engineering-spec.md
git commit -m "docs: 登记 DTO parity gate 为跨边界 DTO 改动验证项"
```

---

## Self-Review

**1. Spec coverage（对照 HTML 候选 4 三收益）：**
- 「drift 可见化（红箭头转编译失败）」→ Task 2+3 建立 gate，Task 3 Step 5 用 project 域已知 drift 验证 gate 抓得到。✓
- 「leverage：parity 自动成立，删 9+ 处手维护注释」→ Task 4 全量覆盖后，Task 5 删冗余注释。✓
- 「locality：契约一处定义」→ Rust types/ 为单一事实源，前端测试对比。✓
- 「回写 contract 表真实路径」→ Task 1。✓

**2. Placeholder scan：**
- Task 2 Step 2 的 `is_skipped` 含明确标注的「实现注意」修正指引（非空洞 TBD），执行时按指引实现。其余代码块为完整可编译骨架。
- Task 4 的 mismatch 数量未知属任务固有不确定性，已用 triage protocol + 分轮 commit + .scratch 笔记显式管理，非占位。

**3. Type consistency：**
- 签名 schema（`structs`/`enums`/`fields`/`required|optional`/`variants`/`rename`）在 Task 2 Rust 导出与 Task 3 TS 消费两侧字段名一致。
- `rustToTsName` / `rustOnlyAllowlist` 在 Task 3 定义、Task 4 扩充，名字一致。
- rename 算法（`to_camel_case` / `pascal_to_snake` / `apply_enum_rename`）Rust（Task 2）与 TS（Task 3 rename.ts）双侧实现，语义对齐。

**已知风险/不在范围：**
- 泛型 DTO（若有 `struct Foo<T>`）当前解析器不展开泛型参数类型；types/ 抽样未见跨边界泛型 DTO，若 Task 4 发现再补。
- 嵌套结构类型 kind 不对齐（如 TS 内联 `{branch,path}` vs Rust 具名 `CodeWorkspaceRoot`）：gate 只校验字段名集合与可选性，不校验嵌套类型名。HTML 候选 4 核心诉求是「字段漂移」，嵌套类型名差异属可接受的弱 parity（已弃用类型 kind 对齐）。若 Task 4 判定某嵌套差异是真 drift，按 Task 4 triage 修。
- Task 4 工作量取决于首次 diff 规模，可能显著超出其余 task。
