//! DTO parity 导出器：解析 src/types/*.rs，导出归一化签名 JSON。
//! 由 dto-parity 前端测试消费。零生产依赖（syn 仅 dev-dep）。
//!
//! 签名 schema：
//! ```json
//! {
//!   "structs": { "<RustStructName>": { "fields": { "<camelCaseFieldName>": "required"|"optional" } } },
//!   "enums":   { "<RustEnumName>":   { "rename": "camelCase"|"snake_case"|"SCREAMING_SNAKE_CASE",
//!                                       "variants": ["<serialized variant string>"] } }
//! }
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use syn::punctuated::Punctuated;
use syn::{Item, ItemEnum, ItemStruct, Token};

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

#[derive(serde::Serialize, PartialEq, Debug)]
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

// ---------------------------------------------------------------------------
// serde 属性解析（rename_all / per-field rename / default / skip / Option）
// ---------------------------------------------------------------------------

/// 从 struct/enum 的 `#[serde(...)]` 属性取 `rename_all` 值。
fn extract_rename_all(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let mut hit: Option<String> = None;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("rename_all") {
                let value = meta.value()?;
                let s: syn::LitStr = value.parse()?;
                hit = Some(s.value());
            }
            Ok(())
        });
        if hit.is_some() {
            return hit;
        }
    }
    None
}

/// 字段是否被 serde skip（不跨边界）。
fn is_skipped(attrs: &[syn::Attribute]) -> bool {
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let mut hit = false;
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("skip")
                || meta.path.is_ident("skip_serializing")
                || meta.path.is_ident("skip_deserializing")
            {
                hit = true;
            }
            Ok(())
        });
        if hit {
            return true;
        }
    }
    false
}

#[allow(dead_code)]
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

/// 字段是否带 `#[serde(skip_serializing_if = "...")]`。
///
/// 这是判断「序列化时键是否可能缺失」的唯一可靠信号：
/// - `Option<T>` 单独存在时 serde 仍会序列化为 `null`（键始终存在）；
/// - `Vec<T>` 单独存在时始终序列化为数组（哪怕是空）；
/// - 只有 `skip_serializing_if` 让 serde 在条件成立时省略键，TS 端才能用 `field?: ...`。
fn field_has_skip_serializing_if(attrs: &[syn::Attribute]) -> bool {
    let mut hit = false;
    for attr in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("skip_serializing_if") {
                // 取一下 value 以推进解析；具体函数名不影响判定。
                let _ = meta.value()?;
                hit = true;
            }
            Ok(())
        });
    }
    hit
}

// 注：`is_option` 与 `field_has_default` 在序列化语义重写后不再驱动 optional 判定。
// 保留 `field_has_default` 供未来反序列化方向（TS→Rust 输入 DTO）的扩展使用；
// plain `Option<T>` 的判定已交给 `skip_serializing_if` 单一信号。

/// per-field `#[serde(rename = "...")]`，若存在返回其值。
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

/// struct/enum 是否 derive 了 `Serialize` 或 `Deserialize`（跨边界 DTO 标识）。
fn derives_serde(attrs: &[syn::Attribute]) -> bool {
    for attr in attrs.iter().filter(|a| a.path().is_ident("derive")) {
        if let Ok(list) = attr.meta.require_list() {
            if let Ok(paths) =
                list.parse_args_with(Punctuated::<syn::Path, Token![,]>::parse_terminated)
            {
                for p in paths {
                    if p.is_ident("Serialize") || p.is_ident("Deserialize") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// rename_all 文本转换
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 主解析
// ---------------------------------------------------------------------------

fn parse_struct(item: &ItemStruct) -> Option<(String, StructSig)> {
    if !derives_serde(&item.attrs) {
        return None;
    }
    let rename_all = extract_rename_all(&item.attrs);
    let mut fields: BTreeMap<String, FieldOptionality> = BTreeMap::new();
    if let syn::Fields::Named(named) = &item.fields {
        for f in &named.named {
            if is_skipped(&f.attrs) {
                continue;
            }
            // per-field #[serde(rename = "...")] 优先；否则按 struct rename_all 转换。
            let raw = f.ident.as_ref().unwrap().to_string();
            let name = field_rename(&f.attrs).unwrap_or_else(|| match rename_all.as_deref() {
                Some("camelCase") => to_camel_case(&raw),
                _ => raw.clone(),
            });
            // 「键在序列化时是否可能缺失」唯一信号是 skip_serializing_if：
            // - `Option<T>` 无 skip：serde 始终写出键（值为 null）→ required
            // - `Vec<T>` 无 skip：始终写出键（值可能为空数组）→ required
            // - 任何类型 + skip_serializing_if：键可能缺失 → optional
            // `#[serde(default)]` 只影响反序列化，不影响序列化输出，不计入。
            let optional = field_has_skip_serializing_if(&f.attrs);
            fields.insert(
                name,
                if optional {
                    FieldOptionality::Optional
                } else {
                    FieldOptionality::Required
                },
            );
        }
    }
    Some((item.ident.to_string(), StructSig { fields }))
}

fn parse_enum(item: &ItemEnum) -> Option<(String, EnumSig)> {
    if !derives_serde(&item.attrs) {
        return None;
    }
    let rename_all = extract_rename_all(&item.attrs).unwrap_or_else(|| "camelCase".into());
    let variants = item
        .variants
        .iter()
        .map(|v| apply_enum_rename(&v.ident.to_string(), &rename_all))
        .collect();
    Some((
        item.ident.to_string(),
        EnumSig {
            rename: rename_all,
            variants,
        },
    ))
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
    let project = sigs
        .structs
        .get("ProjectSummary")
        .expect("ProjectSummary 存在");
    assert_eq!(project.fields.get("id"), Some(&FieldOptionality::Required));
    // ProjectSummary.code_workspaces 是 `Vec<CodeWorkspaceRoot>` 带 `#[serde(default)]`
    // 但无 `skip_serializing_if` —— 序列化时键始终存在（值为数组，可能为空）。
    // 按序列化语义判定为 required（前端 TS 须配 `codeWorkspaces: ...` 才能对齐）。
    assert_eq!(
        project.fields.get("codeWorkspaces"),
        Some(&FieldOptionality::Required)
    );
    assert!(sigs.enums.contains_key("ProjectWorktreeLocation"));
    assert!(sigs.enums.contains_key("CommandErrorCode"));

    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../src/shared/commands/__parity__/rust-dto-signatures.json");
    fs::create_dir_all(out.parent().unwrap()).unwrap();
    let json = serde_json::to_string_pretty(&sigs).unwrap();
    fs::write(&out, json).unwrap();
}
