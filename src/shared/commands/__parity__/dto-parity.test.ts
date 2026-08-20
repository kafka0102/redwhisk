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
// here = src/shared/commands/__parity__/；向上三级到 src/，再拼各 surface 的 commands.ts。
const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../../..");
const tsFiles = [
  path.join(srcDir, "features/project/project-commands.ts"),
  path.join(srcDir, "features/issues/issue-commands.ts"),
  path.join(srcDir, "features/agents/agent-session-commands.ts"),
  // agent-session DTOs 一部分定义在 agent-stream-types.ts（事件流 / timeline / 权限 /
  // 模型 / 模式等），agent-session-commands.ts 通过 `import type` 复用。该文件是
  // agent session surface 的事实镜像，必须纳入 parity 范围。
  path.join(srcDir, "features/agents/agent-stream-types.ts"),
  path.join(
    srcDir,
    "features/agents/session-workspace/session-workspace-commands.ts",
  ),
  path.join(
    srcDir,
    "features/agents/session-notifications/session-monitor-commands.ts",
  ),
  path.join(srcDir, "features/terminals/project-terminal-commands.ts"),
  path.join(srcDir, "features/settings/settings-commands.ts"),
  path.join(srcDir, "shared/commands/app-commands.ts"),
  path.join(srcDir, "shared/commands/app-update-commands.ts"),
  path.join(srcDir, "shared/workspace/workspace-commands.ts"),
  path.join(srcDir, "features/code/code-language-commands.ts"),
];

const ts = extractAllTsSignatures(tsFiles);

function tsNameFor(rustName: string): string {
  return rustToTsName[rustName] ?? rustName;
}

describe("DTO parity（Rust 跨边界 → TS mirror）", () => {
  // parity 仅校验 Rust→TS 方向：Rust 跨边界 struct/enum 的每个字段/变体必须在 TS 侧
  // 有对应（同名 interface / 同 tag 字面量），且字段可选性一致。TS 侧多出的字段 /
  // 变体（前端 UI 别名、辅助派生类型）不破坏 Rust→TS 契约，不报错。
  it("Rust 每个跨边界 struct 在 TS 侧有对应 interface 且字段一致", () => {
    const mismatches: string[] = [];
    for (const [rustName, rustSig] of Object.entries(rust.structs)) {
      if (rustOnlyAllowlist.has(rustName)) continue;
      const tsName = tsNameFor(rustName);
      const tsSig = ts.structs[tsName];
      if (!tsSig) {
        mismatches.push(`${rustName}: TS 侧缺少 interface ${tsName}`);
        continue;
      }
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
    }
    expect(mismatches).toEqual([]);
  });

  it("Rust 跨边界 enum 变体与 TS 一致", () => {
    const mismatches: string[] = [];
    for (const [rustName, rustSig] of Object.entries(rust.enums)) {
      if (rustOnlyAllowlist.has(rustName)) continue;
      const tsName = tsNameFor(rustName);
      const tsSig = ts.enums[tsName];
      if (!tsSig) {
        mismatches.push(`${rustName}: TS 缺少 union ${tsName}`);
        continue;
      }
      const rustSet = new Set(rustSig.variants);
      const tsSet = new Set(tsSig.variants);
      for (const v of rustSet)
        if (!tsSet.has(v)) mismatches.push(`${rustName}: TS 缺少变体 ${v}`);
    }
    expect(mismatches).toEqual([]);
  });
});
