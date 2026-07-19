import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import rustRaw from "./rust-dto-signatures.json";
import { extractAllTsSignatures } from "./extract-ts-signatures";
import { rustToTsName, rustOnlyAllowlist } from "./name-mapping";

interface RustSig {
  structs: Record<string, { fields: Record<string, "required" | "optional"> }>;
  enums: Record<string, { rename: string; variants: string[] }>;
}

const rust = rustRaw as RustSig;
// 用 import.meta.url 解析 ESM 下的当前文件目录；tsconfig 已加入 "node" 类型。
const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.resolve(here, "../../..");
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
      const isProjectDomain = [
        "ProjectSummary",
        "CreateProjectInput",
        "OpenProjectInput",
        "UpdateProjectSettingsInput",
        "ValidateProjectRepoPathInput",
        "ValidateProjectRepoPathResponse",
        "ProjectListResponse",
        "ProjectListItem",
        "OpenProjectWindowResponse",
      ].includes(rustName);
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
          mismatches.push(
            `${rustName}.${field}: 可选性 Rust=${opt} TS=${tsOpt}`,
          );
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
      const isProjectDomain = [
        "ProjectWorktreeLocation",
        "ProjectPathStatus",
      ].includes(rustName);
      if (!isProjectDomain) continue;
      if (!tsSig) {
        mismatches.push(`${rustName}: TS 缺少 union ${tsName}`);
        continue;
      }
      const rustSet = new Set(rustSig.variants);
      const tsSet = new Set(tsSig.variants);
      for (const v of rustSet)
        if (!tsSet.has(v)) mismatches.push(`${rustName}: TS 缺少变体 ${v}`);
      for (const v of tsSet)
        if (!rustSet.has(v)) mismatches.push(`${rustName}: TS 多出变体 ${v}`);
    }
    expect(mismatches).toEqual([]);
  });
});
