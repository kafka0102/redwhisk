import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import legacyInterfaceKeys from "./__fixtures__/legacy-messages-interface-keys.json";

/**
 * `I18nMessages` 是历史字典迁入 JSON 后的存量接口。规则见
 * docs/architecture-design/agent-development-rules.md「文案与国际化」：
 * 新增文案只写 locales/{en,zh}.json，组件用 t("namespace.key")，不扩展这个接口。
 *
 * 这条规则是机械的（新增一个接口成员就是固定形状的违规），所以用快照钉住，
 * 不依赖实现或复审时的记忆。移除存量 key 不算违规，无需更新快照。
 */
function extractInterfaceKeys(source: string): string[] {
  const start = source.indexOf("export interface I18nMessages {");
  if (start < 0) {
    throw new Error("messages.ts 中未找到 I18nMessages 接口");
  }

  const keys: string[] = [];
  let namespace: string | null = null;
  for (const line of source.slice(start).split("\n").slice(1)) {
    if (line === "}") {
      break;
    }

    const opened = /^ {2}([A-Za-z0-9_]+): \{$/.exec(line);
    if (opened) {
      namespace = opened[1];
      continue;
    }
    if (/^ {2}\}/.test(line)) {
      namespace = null;
      continue;
    }

    const member = /^ {4}([A-Za-z0-9_]+):/.exec(line);
    if (member && namespace) {
      keys.push(`${namespace}.${member[1]}`);
    }
  }

  return keys;
}

const interfaceKeys = extractInterfaceKeys(
  readFileSync(resolve(process.cwd(), "src/shared/i18n/messages.ts"), "utf8"),
);

describe("I18nMessages 存量接口", () => {
  it("解析结果覆盖接口全部分命名空间", () => {
    // 解析守卫：正则与接口写法失配时先在这里红，不让下面的子集断言静默通过。
    expect(interfaceKeys.length).toBeGreaterThan(500);
    expect(new Set(interfaceKeys.map((key) => key.split(".")[0])).size).toBe(
      14,
    );
  });

  it("只在移除存量 key，不新增", () => {
    const legacy = new Set(legacyInterfaceKeys.keys);
    const added = interfaceKeys.filter((key) => !legacy.has(key)).sort();
    expect(
      added,
      `新增 I18nMessages key：${added.join(", ")}。新增文案请写 locales/{en,zh}.json 并用 t("namespace.key")；确需扩展存量接口时，同步更新 src/shared/i18n/__fixtures__/legacy-messages-interface-keys.json 并说明理由。`,
    ).toEqual([]);
  });
});
