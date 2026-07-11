import { describe, expect, it } from "vitest";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

type Dict = Record<string, unknown>;

function flatten(obj: Dict, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(out, flatten(value as Dict, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

const enFlat = flatten(en as Dict);
const zhFlat = flatten(zh as Dict);
const zhText = JSON.stringify(zh);

describe("locale resources", () => {
  it("have identical key trees", () => {
    expect(Object.keys(zhFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it("placeholders match across locales for every key", () => {
    const placeholder = /\{\{(\w+)\}\}/g;
    for (const key of Object.keys(enFlat)) {
      const enPh = (enFlat[key].match(placeholder) ?? []).sort().toString();
      const zhPh = (zhFlat[key]?.match(placeholder) ?? []).sort().toString();
      expect(zhPh, `placeholder mismatch at ${key}`).toBe(enPh);
    }
  });

  it("uses no closure leftovers or raw template syntax", () => {
    expect(zhText).not.toMatch(/\$\{/);
    expect(JSON.stringify(en)).not.toMatch(/\$\{/);
  });

  it("globalSettings language labels are 简体中文 / English", () => {
    const enG = (en as Dict).globalSettings as Dict;
    const zhG = (zh as Dict).globalSettings as Dict;
    expect(zhG.chinese).toBe("简体中文");
    expect(zhG.english).toBe("English");
    expect(enG.chinese).toBe("简体中文");
    expect(enG.english).toBe("English");
  });

  it("zh uses unified terminology 智能体 / 会话 / 任务", () => {
    expect(zhText).toContain("智能体");
    expect(zhText).toContain("会话");
    expect(zhText).toContain("任务");
    expect(zhText).not.toMatch(/代理/);
  });
});
