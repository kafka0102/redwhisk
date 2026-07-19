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
    const optional =
      decl?.questionToken !== undefined ? "optional" : "required";
    fields[prop.name] = optional;
  }
  return fields;
}

/** union 字面量类型（如 "a" | "b"）的变体。返回 null 表示非字面量 union。 */
function collectUnionVariants(node: ts.TypeAliasDeclaration): string[] | null {
  if (!node.type || !ts.isUnionTypeNode(node.type)) {
    return null;
  }
  // 任一 member 不是字面量 → 视为非字面量 union（可能是判别 union），返回 null 让下游处理。
  const variants: string[] = [];
  for (const t of node.type.types) {
    if (!ts.isLiteralTypeNode(t) || !ts.isStringLiteral(t.literal)) {
      return null;
    }
    variants.push(t.literal.text);
  }
  return variants.length > 0 ? variants : null;
}

/**
 * 判别 union（discriminated union）的 tag 字面量集合。
 *
 * 对应 Rust 的 `#[serde(tag = "type", rename_all = "snake_case")]` enum：
 * 每个 union member 是 `{ type: "thread_started"; ... }` 形式的 type literal。
 * 返回所有 member 的 `type` 字段字面量；若任一 member 没有 `type: <stringLiteral>`
 * 属性则返回 null（视为非判别 union，不当作 enum）。
 */
function collectDiscriminatedUnionVariants(
  node: ts.TypeAliasDeclaration,
): string[] | null {
  if (!node.type || !ts.isUnionTypeNode(node.type)) {
    return null;
  }
  const variants: string[] = [];
  for (const member of node.type.types) {
    if (!ts.isTypeLiteralNode(member)) {
      return null;
    }
    let tag: string | null = null;
    for (const m of member.members) {
      if (
        ts.isPropertySignature(m) &&
        m.name &&
        ts.isIdentifier(m.name) &&
        m.name.text === "type" &&
        m.type &&
        ts.isLiteralTypeNode(m.type) &&
        ts.isStringLiteral(m.type.literal)
      ) {
        tag = m.type.literal.text;
      }
    }
    if (tag === null) {
      return null;
    }
    variants.push(tag);
  }
  return variants.length > 0 ? variants : null;
}

export function extractTsSignatures(filePath: string): TsSignatures {
  const structs: Record<string, TsStructSig> = {};
  const enums: Record<string, TsEnumSig> = {};
  const program = ts.createProgram({
    rootNames: [filePath],
    options: { noEmit: true, strict: true },
  });
  // 用 program 自己 parse 的 SourceFile，checker 才能解析 symbol 与 properties；
  // 单独 createSourceFile 出来的 node 与 program 不在同一张图上，properties 恒为空。
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`无法从 program 获取 source file: ${filePath}`);
  }
  const checker = program.getTypeChecker();

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node)) {
      structs[node.name.text] = {
        fields: collectInterfaceFields(node, checker),
      };
    } else if (ts.isTypeAliasDeclaration(node)) {
      // 先按字面量 union 解析（"a" | "b"）；否则尝试判别 union（{type: "a"} | {type: "b"}）。
      const variants =
        collectUnionVariants(node) ?? collectDiscriminatedUnionVariants(node);
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
