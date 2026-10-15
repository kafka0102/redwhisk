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

  it("tui hook card copy exists in zh and en without claiming trust", () => {
    const keys = [
      "settings.tuiHookTitle",
      "settings.tuiHookScopeNotice",
      "settings.tuiHookTrustNotice",
      "settings.tuiHookKeepOthersNotice",
      "settings.tuiHookStatusUnregistered",
      "settings.tuiHookStatusRegistered",
      "settings.tuiHookStatusTrustMayBeRequired",
      "settings.tuiHookChannelUnavailable",
      "settings.tuiHookChannelShort",
      "settings.tuiHookFeatureDisabled",
      "settings.tuiHookFeatureShort",
      "settings.tuiHookHelpLabel",
      "settings.tuiHookEnableFeature",
      "settings.tuiHookEnableFeatureShort",
      "settings.tuiHookInstall",
      "settings.tuiHookUninstall",
      "settings.tuiHookRecheck",
      "settings.tuiHookCodex",
      "settings.tuiHookGrok",
    ];
    for (const key of keys) {
      expect(zhFlat[key], key).toBeTruthy();
      expect(enFlat[key], key).toBeTruthy();
    }
    expect(zhFlat["settings.tuiHookScopeNotice"]).toContain("RedWhisk");
    expect(zhFlat["settings.tuiHookTrustNotice"]).toContain("/hooks");
    expect(zhFlat["settings.tuiHookKeepOthersNotice"]).toContain("hook");
    expect(enFlat["settings.tuiHookScopeNotice"]).toContain("RedWhisk");
    expect(enFlat["settings.tuiHookTrustNotice"]).toContain("/hooks");
    expect(zhFlat["settings.tuiHookStatusRegistered"]).not.toMatch(
      /已信任|已生效/,
    );
    expect(enFlat["settings.tuiHookStatusRegistered"]).not.toMatch(
      /trusted|active/i,
    );
    expect(zhFlat["settings.tuiHookChannelUnavailable"]).toContain(
      "本机状态通道不可用",
    );
    expect(zhFlat["settings.tuiHookChannelShort"]).toBe("通道不可用");
    expect(enFlat["settings.tuiHookChannelShort"]).toBe("Channel unavailable");
    expect(zhFlat["settings.tuiHookFeatureShort"]).toBe("hooks 未开启");
    expect(enFlat["settings.tuiHookFeatureShort"]).toBe("Hooks off");
    expect(zhFlat["settings.tuiHookEnableFeatureShort"]).toBe("开启 hooks");
    expect(enFlat["settings.tuiHookEnableFeatureShort"]).toBe("Enable hooks");
    expect(zhFlat["settings.tuiHookHelpLabel"]).toBe("说明");
    expect(enFlat["settings.tuiHookHelpLabel"]).toBe("About");
    expect(zhFlat["settings.tuiHookEnableFeature"].length).toBeGreaterThan(
      zhFlat["settings.tuiHookEnableFeatureShort"].length,
    );
  });

  it("zh uses unified terminology 智能体 / 会话 / 任务", () => {
    expect(zhText).toContain("智能体");
    expect(zhText).toContain("会话");
    expect(zhText).toContain("任务");
    expect(zhText).not.toMatch(/代理/);
  });
});
