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

/** union 字面量类型（如 "a" | "b"）的变体。 */
function collectUnionVariants(node: ts.TypeAliasDeclaration): string[] | null {
  if (!node.type || !ts.isUnionTypeNode(node.type)) {
    return null;
  }
  return node.type.types
    .map((t) =>
      ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)
        ? t.literal.text
        : null,
    )
    .filter((v): v is string => v !== null);
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
