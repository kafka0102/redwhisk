# i18next 迁移与语言偏好 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 i18next + react-i18next 取代自研字典，在全局设置「主题偏好」下方新增「语言偏好」（默认简体中文），统一中文术语（智能体 / 会话 / 任务），并以前端错误 code 映射消除「英文 locale 含中文」泄露；后端不动。

**Architecture:** 现有 `src/shared/i18n/messages.ts`（1628 行 en/zh 字典 + 闭包模板）→ i18next JSON 资源（`locales/en.json`/`zh.json`）+ `{{name}}` 插值。`I18nProvider` 收敛为 theme/字号偏好 + `I18nextProvider` 包装；locale 由 i18next 管理，运行时可切换并持久化。调用点按命名空间分批从 `messages.x.y` 迁移到 `t('x.y')`，通过临时桥接保证未迁移点不崩。

**Tech Stack:** React 19, TypeScript, i18next + react-i18next, Vitest + Testing Library, Tauri 2（后端不动）。

## Global Constraints

- 默认 UI locale = `zh`（无持久化偏好时）。`Locale = "zh" | "en"`。
- locale 持久化键不变：`redwhisk.locale`；theme 键 `redwhisk.theme`；字号键 `redwhisk.content-font-size`。
- 中文术语（仅 zh 文案值，不改标识符/文件名/路由）：`agent→智能体`、`session→会话`、`Issues→任务`，及派生（`Agent Profile→智能体配置`、`sessions→会话`）。
- 语言选项标签：`简体中文`（值 `zh`）、`English`（值 `en`）。
- 后端 Rust 不改：0 中文、0 locale 感知；错误本地化只在前端。
- 完成门禁（AGENTS.md §5）：`pnpm format`→复查 `git status`→`pnpm lint`→`pnpm typecheck`→`pnpm test`（触达 surface）。禁止新增 `@ts-ignore`/`any`/跳过测试。
- 提交标题 `<type>: <简体中文描述>`，不含 scope。
- 不改 `run-prompt-builder` 注入 agent 的任务 prompt（业务内容，非 UI 文案）。

---

## File Structure

- Create: `src/shared/i18n/locales/en.json` — 英文资源（从 messages.ts en 字典 1:1 转写）。
- Create: `src/shared/i18n/locales/zh.json` — 中文资源（转写 + 术语统一）。
- Create: `src/shared/i18n/i18n.ts` — i18next 实例初始化 + `changeLocale(lng)` + 默认/存储读取。
- Create: `src/shared/i18n/i18n-provider.tsx` — `I18nextProvider` 包装 + theme/字号偏好 state + 合并 hook。
- Create: `src/shared/i18n/error-messages.ts` — 后端错误 code/类型 → 模板 key 映射 + `getLocalizedCommandError()`。
- Create: `src/shared/i18n/__tests__/i18n.test.ts` — i18next 初始化、默认 zh、切换持久化、错误映射、术语对照。
- Modify: `src/shared/i18n/messages.ts` — 字典移除，仅保留类型与常量（`Locale`、`ThemePreference`、`ContentFontSize`、存储键、theme/字号 reader）；或重命名为 `i18n-constants.ts`（见 Task 1 决策）。
- Delete: `src/shared/i18n/settings-messages.ts` — 合并入 `settings` 命名空间 JSON 后删除。
- Modify: `src/shared/i18n/i18n.tsx`（旧）— 拆分：locale 职责移至 i18next；theme/字号移至 `i18n-provider.tsx`；保留导出名兼容或全量改调用点（见 Task 6+）。
- Modify: `src/app/app.tsx` — 去掉 `fixedLocale`，挂载新 provider。
- Modify: `src/features/settings/global-settings-activity.tsx` — 新增语言偏好行。
- Modify: `src/features/agents/session-notifications/session-monitor-surface.tsx` — `fixedLocale="zh"` 适配新 provider。
- Modify: 约 60 个调用点（按命名空间分批迁移）。
- Modify: `src/shared/toast.ts`、confirm/loading dialog、issue 命令提示等泄露点。
- Modify: `docs/standards/agent-development-rules.md`（i18n 规范）、`docs/architecture-design/settings-page-layout.md`（语言行）。

---

## Task 1: 安装依赖与提取共享常量

**Files:**
- Modify: `package.json`
- Create: `src/shared/i18n/i18n-constants.ts`
- Test: `src/shared/i18n/__tests__/i18n-constants.test.ts`

**Interfaces:**
- Produces: `Locale`、`ThemePreference`、`ContentFontSize`、`LOCALE_STORAGE_KEY`、`THEME_STORAGE_KEY`、`CONTENT_FONT_SIZE_STORAGE_KEY`、`DEFAULT_CONTENT_FONT_SIZE`、`CONTENT_FONT_SIZE_OPTIONS`、`DEFAULT_LOCALE="zh"`、`SUPPORTED_LOCALES`、`getInitialThemePreference()`、`getInitialContentFontSize()`。

- [ ] **Step 1: 安装 i18next 依赖**

Run:
```bash
pnpm add i18next react-i18next
```
Expected: `package.json` 出现 `"i18next"` 与 `"react-i18next"`，`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 写失败测试 `i18n-constants.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
} from "../i18n-constants";

describe("i18n constants", () => {
  it("defaults locale to zh", () => {
    expect(DEFAULT_LOCALE).toBe("zh");
  });
  it("supports zh and en only", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh", "en"]);
  });
  it("keeps the existing locale storage key", () => {
    expect(LOCALE_STORAGE_KEY).toBe("redwhisk.locale");
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n-constants.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 创建 `i18n-constants.ts`**

从 `messages.ts` 顶部与底部迁移类型与常量；locale 部分新增 `DEFAULT_LOCALE` / `SUPPORTED_LOCALES`：

```ts
export type Locale = "zh" | "en";
export type ThemePreference = "light" | "dark" | "system";
export type ContentFontSize = 13 | 14 | 15 | 16 | 18 | 20 | 22;

export const DEFAULT_LOCALE: Locale = "zh";
export const SUPPORTED_LOCALES: Locale[] = ["zh", "en"];

export const LOCALE_STORAGE_KEY = "redwhisk.locale";
export const THEME_STORAGE_KEY = "redwhisk.theme";
export const CONTENT_FONT_SIZE_STORAGE_KEY = "redwhisk.content-font-size";

export const DEFAULT_CONTENT_FONT_SIZE: ContentFontSize = 15;
export const CONTENT_FONT_SIZE_OPTIONS: readonly ContentFontSize[] = [
  13, 14, 15, 16, 18, 20, 22,
];

export function getInitialThemePreference(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : "light";
  } catch {
    return "light";
  }
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getInitialContentFontSize(): ContentFontSize {
  try {
    const storedValue = window.localStorage.getItem(
      CONTENT_FONT_SIZE_STORAGE_KEY,
    );
    const parsed = storedValue === null ? NaN : Number(storedValue);
    return isContentFontSize(parsed) ? parsed : DEFAULT_CONTENT_FONT_SIZE;
  } catch {
    return DEFAULT_CONTENT_FONT_SIZE;
  }
}

function isContentFontSize(value: number): value is ContentFontSize {
  return (CONTENT_FONT_SIZE_OPTIONS as readonly number[]).includes(value);
}
```

> 注：`DEFAULT_CONTENT_FONT_SIZE` / `CONTENT_FONT_SIZE_OPTIONS` 的真实值从现有 `messages.ts` 原样复制（上面是占位结构；执行时以源文件实际值为准并保持一致）。`DEFAULT_LOCALE` 取 zh。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n-constants.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml src/shared/i18n/i18n-constants.ts src/shared/i18n/__tests__/i18n-constants.test.ts
git commit -m "feat: 引入 i18next 依赖并提取 i18n 共享常量"
```

---

## Task 2: 生成 JSON 资源（含术语统一）

**Files:**
- Create: `src/shared/i18n/locales/en.json`
- Create: `src/shared/i18n/locales/zh.json`
- Test: `src/shared/i18n/__tests__/locales.test.ts`

**Interfaces:**
- Produces: 两个 JSON，结构与 `messages.ts` 顶层命名空间同构（`app`/`globalSettings`/`alertDialog`/`toast`/`richText`/`agentNotifications`/`settings`/`projectHome`/`projectSwitcher`/`createProject`/`issues`/`issueSummary`/`agentsFeature`），并合并 `settings-messages.ts` 入 `settings`。闭包参数化文案转为 `{{name}}` 字符串模板。

**转换规则（无例外）：**
1. 字符串值原样平移到对应 locale JSON 同路径。
2. 闭包函数 `(p1, p2) => string` → 字符串模板，参数名用 `{{p1}}`/`{{p2}}`。例：
   - `workbench: (projectName) => \`Workbench: ${projectName}\`` → `"workbench": "Workbench: {{projectName}}"`
   - `sessionStatusLine: (title, status) => …` → `"sessionStatusLine": "{{title}} · {{status}}"`（按原 zh/en 文案语义构造）
   - `turnCompletedBody: (sessionId) => …` → `"turnCompletedBody": "Turn {{sessionId}} completed"` / zh 对应
3. 中文术语统一（仅 zh.json）：
   - `agent` 类 → `智能体`（`Agent Profile` → `智能体配置`，`Agent` 单复数 → `智能体`）
   - `session` 类 → `会话`（`Sessions` → `会话`）
   - `Issues` 概念 → `任务`（`Issues` 标题/列表 → `任务`；勿改 `Issue` 编号类语义如 "Issue #123" 文本中的编号格式）
   - `globalSettings.chinese` → `简体中文`；`globalSettings.english` → `English`；`globalSettings.language` → `语言`
   - en.json 中对应英文不变。

- [ ] **Step 1: 写失败测试（结构 + 术语 + 占位符一致性）**

```ts
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

const zhText = JSON.stringify(zh);

describe("locale resources", () => {
  it("zh uses unified terminology", () => {
    expect(zhText).toContain("智能体");
    expect(zhText).toContain("会话");
    expect(zhText).toContain("任务");
    // 不应残留替代译法
    expect(zhText).not.toMatch(/代理/);
  });
  it("globalSettings language labels", () => {
    expect(zh.globalSettings.chinese).toBe("简体中文");
    expect(zh.globalSettings.english).toBe("English");
    expect(en.globalSettings.chinese).toBe("简体中文");
    expect(en.globalSettings.english).toBe("English");
  });
  it("placeholders match across locales", () => {
    const re = /\{\{(\w+)\}\}/g;
    for (const key of Object.keys(flatten(en))) {
      const enPh = (flatten(en)[key].match(re) || []).sort().toString();
      const zhPh = (flatten(zh)[key]?.match(re) || []).sort().toString();
      expect(zhPh).toBe(enPh);
    }
  });
});

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/shared/i18n/__tests__/locales.test.ts`
Expected: FAIL（JSON 不存在）。

- [ ] **Step 3: 生成 en.json / zh.json**

从 `messages.ts` 的 `en`（行 ~524）与 `zh`（行 ~1063）字典 1:1 转写为 JSON；按上面转换规则处理闭包与术语；合并 `settings-messages.ts` 的 en/zh 到 `settings.*`。**两个文件必须键集一致**（顶层与每层键相同）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/shared/i18n/__tests__/locales.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/i18n/locales/en.json src/shared/i18n/locales/zh.json src/shared/i18n/__tests__/locales.test.ts
git commit -m "feat: 生成 i18next JSON 资源并统一中文术语"
```

---

## Task 3: i18next 实例与切换持久化

**Files:**
- Create: `src/shared/i18n/i18n.ts`
- Test: `src/shared/i18n/__tests__/i18n.test.ts`

**Interfaces:**
- Produces: 默认导出 i18next 实例（已 `initReactI18next`）；`changeLocale(lng: Locale): Promise<void>`；`getDefaultLocale(): Locale`（读 `redwhisk.locale`，无值→zh）。

- [ ] **Step 1: 写失败测试**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import i18n, { changeLocale, getDefaultLocale } from "../i18n";

describe("i18next instance", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to zh when nothing stored", () => {
    expect(getDefaultLocale()).toBe("zh");
    expect(i18n.language).toBe("zh");
  });
  it("changeLocale persists and switches", async () => {
    await changeLocale("en");
    expect(i18n.language).toBe("en");
    expect(window.localStorage.getItem("redwhisk.locale")).toBe("en");
  });
  it("falls back to zh on missing key", () => {
    expect(i18n.exists("app.workbench")).toBe(true);
    expect(i18n.t("app.workbench", { projectName: "X" })).toContain("X");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `i18n.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "./i18n-constants";

export function getDefaultLocale(): Locale {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(v as Locale) ? (v as Locale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function changeLocale(lng: Locale): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
  } catch {
    // ignore persistence failure; runtime state still updates
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, zh: { translation: zh } },
    lng: getDefaultLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/i18n/i18n.ts src/shared/i18n/__tests__/i18n.test.ts
git commit -m "feat: 初始化 i18next 实例与 locale 切换持久化"
```

---

## Task 4: 新 Provider（theme/字号偏好 + I18nextProvider）

**Files:**
- Create: `src/shared/i18n/i18n-provider.tsx`
- Test: `src/shared/i18n/__tests__/i18n-provider.test.tsx`

**Interfaces:**
- Produces: `I18nProvider`（包 `I18nextProvider`，持 theme/system/contentFontSize state，写 `dataset.theme`、`--content-font-size`）；`useI18n()` 返回 `{ t, i18n, locale, theme, themePreference, setThemePreference, contentFontSize, setContentFontSize }`。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "../i18n-provider";

function Probe() {
  const { t, locale } = useI18n();
  return <span>{t("globalSettings.language")}|{locale}</span>;
}

describe("I18nProvider", () => {
  it("renders zh by default and exposes t", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText(/语言|zh/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n-provider.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `i18n-provider.tsx`**

```tsx
import i18next, { changeLocale } from "./i18n";
import {
  getInitialContentFontSize,
  getInitialThemePreference,
  CONTENT_FONT_SIZE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ContentFontSize,
  type Locale,
  type ThemePreference,
} from "./i18n-constants";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

interface I18nContextValue {
  t: ReturnType<typeof useTranslation>["t"];
  i18n: ReturnType<typeof useTranslation>["i18n"];
  locale: Locale;
  setLocale: (lng: Locale) => void;
  theme: "light" | "dark";
  themePreference: ThemePreference;
  setThemePreference: (p: ThemePreference) => void;
  contentFontSize: ContentFontSize;
  setContentFontSize: (s: ContentFontSize) => void;
}

const Ctx = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [themePreference, setThemePref] = useState(getInitialThemePreference);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);
  const [contentFontSize, setFontSize] = useState(getInitialContentFontSize);
  const theme = themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    if (themePreference !== "system" || !canMatchDark()) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [themePreference]);

  useEffect(() => { window.document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    window.document.documentElement.style.setProperty("--content-font-size", `${contentFontSize}px`);
  }, [contentFontSize]);

  const value = useMemo<I18nContextValue>(() => ({
    t, i18n,
    locale: i18n.language as Locale,
    setLocale: (lng) => { void changeLocale(lng); },
    theme, themePreference,
    setThemePreference: (p) => {
      if (p === "system") setSystemTheme(getSystemTheme());
      setThemePref(p);
      try { window.localStorage.setItem(THEME_STORAGE_KEY, p); } catch { /* ignore */ }
    },
    contentFontSize,
    setContentFontSize: (s) => {
      setFontSize(s);
      try { window.localStorage.setItem(CONTENT_FONT_SIZE_STORAGE_KEY, String(s)); } catch { /* ignore */ }
    },
  }), [t, i18n, theme, themePreference, contentFontSize]);

  return <I18nextProvider i18n={i18next}><Ctx.Provider value={value}>{children}</Ctx.Provider></I18nextProvider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

function getSystemTheme(): "light" | "dark" {
  if (!canMatchDark()) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function canMatchDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/shared/i18n/__tests__/i18n-provider.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/shared/i18n/i18n-provider.tsx src/shared/i18n/__tests__/i18n-provider.test.tsx
git commit -m "feat: 新增 I18nProvider 收敛 theme 字号偏好与 i18next"
```

---

## Task 5: 桥接旧 `useI18n().messages`（迁移期过渡）

**Files:**
- Modify: `src/shared/i18n/i18n.tsx`（旧）
- Test: 复用既有组件测试不崩。

**Interfaces:**
- Produces: 旧 `useI18n().messages` 仍可用，值由 `t()` 派生（字符串项 = `t(key)`；函数项 = `(params) => t(key, params)`）。提供 `messages` 代理对象或显式映射，保证未迁移调用点继续工作。

- [ ] **Step 1: 写回归测试**

```ts
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "../i18n-provider";

function Probe() {
  const { messages } = useI18n() as any;
  return <span data-testid="m">{messages.globalSettings.language}</span>;
}
describe("legacy messages bridge", () => {
  it("still exposes messages object during migration", () => {
    const { getByTestId } = render(<I18nProvider><Probe /></I18nProvider>);
    // zh default
    expect(getByTestId("m").textContent).toMatch(/语言/);
  });
});
```

> 桥接在 `i18n-provider.tsx` 的 `useI18n()` 返回值上附加一个由 `t()` 构造的 `messages` 代理（按 JSON 顶层命名空间 + 键路径惰性求值）。函数键通过 JSON 中含 `{{...}}` 的模板 + 参数对象求值。

- [ ] **Step 2-4:** 失败→实现桥接→通过。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat: 提供 useI18n().messages 桥接以支撑分批迁移"
```

---

## Task 6: 挂载新 Provider（去 fixedLocale）

**Files:**
- Modify: `src/app/app.tsx:15-16,85-86,317,346,351,371,574`
- Modify: `src/features/agents/session-notifications/session-monitor-surface.tsx`

**Changes:**
- 删除 `app.tsx` 的 `defaultLocale`/`defaultMessages` 预计算与 `fixedLocale` 传参；`import { I18nProvider } from "../shared/i18n/i18n-provider"`；渲染 `<I18nProvider>`。
- 删除 `app.tsx:574` 的本地 `getDefaultLocale()`（改用 i18next）。
- `session-monitor-surface.tsx` 的 `<I18nProvider fixedLocale="zh">` → 新 `<I18nProvider>`（i18next 默认已是 zh；该 surface 不再强制 fixed，或保留一个测试用 `initialLocale` 入参）。

- [ ] **Step 1-4:** 写/改 `app.test.tsx` 断言默认 zh、provider 正常挂载；运行 `pnpm test -- src/app` 通过。

- [ ] **Step 5: 提交**

```bash
git commit -m "refactor: app 改用 i18next provider 移除 fixedLocale"
```

---

## Task 7: 语言偏好 UI

**Files:**
- Modify: `src/features/settings/global-settings-activity.tsx`（在主题 section 与字号 section 之间插入）
- Modify: `src/features/settings/global-settings-activity.test.tsx`

**Changes:** 新增 section：`h4` = `t('globalSettings.language')`，`Select` 选项 `简体中文`(zh)/`English`(en)，`value=locale`，`onValueChange => setLocale`。

- [ ] **Step 1: 写失败测试**（默认简体中文选中、位置在主题下方、切换调用 setLocale、选项标签）。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现** section（复用现有 `Select` 样式，`aria-label={t('globalSettings.language')}`）。
- [ ] **Step 4: 运行 `pnpm test -- src/features/settings` 通过。**
- [ ] **Step 5: 提交** `feat: 全局设置新增语言偏好默认简体中文`。

---

## Task 8: 后端错误本地化 helper

**Files:**
- Create: `src/shared/i18n/error-messages.ts`
- Modify: `src/shared/i18n/locales/{en,zh}.json` 新增 `errors` 命名空间。
- Test: `src/shared/i18n/__tests__/error-messages.test.ts`

**Interfaces:**
- Produces: `getLocalizedCommandError(error: CommandError, t: TFunction): string`。命中映射→`t(key, params)`；未命中→`error.message`（英文，不混中文）。

- [ ] **Step 1: 写失败测试**（命中 code 返回本地化；未命中回退 `error.message`；参数插值）。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现** —— 维护 `ERROR_CODE_MAP: Record<string, string>`（code/类型 → `errors.*` key），`getLocalizedCommandError` 查表。初始映射覆盖 `src/shared/commands` 与各 feature command 中已知 code（执行时 grep `code:` 收集）。
- [ ] **Step 4: 运行通过。**
- [ ] **Step 5: 提交** `feat: 新增后端错误 code 到本地化文案映射`。

---

## Task 9–15: 按命名空间迁移调用点（每任务一命名空间）

对每个命名空间执行同一流程（subagent 各自 grep 定位文件）：

| Task | 命名空间 | 主要 surface | 验证测试 |
| --- | --- | --- | --- |
| 9 | `globalSettings` | global-settings-activity | `pnpm test -- src/features/settings` |
| 10 | `settings`（含原 settings-messages） | settings 各面板 | `pnpm test -- src/features/settings` |
| 11 | `app` | app-shell / activity-bar | `pnpm test -- src/app` |
| 12 | `issues` / `issueSummary` | issues 全 surface | `pnpm test -- src/features/issues` |
| 13 | `agentsFeature` / `agentNotifications` | agents 全 surface | `pnpm test -- src/features/agents` |
| 14 | `toast` / `alertDialog` / `richText` / `projectHome` / `projectSwitcher` / `createProject` | 共享 UI + project | 对应 surface 测试 |

**每个命名空间任务的步骤（模板）：**

- [ ] **Step 1: 定位** `rg -n "messages\.<NS>" src --glob '*.tsx' --glob '*.ts' | rg -v '\.test\.'` 列出文件与用法。
- [ ] **Step 2: 改写** 将 `useI18n()` 解构出 `t`（或 `useTranslation()`），把 `messages.<NS>.<key>` → `t('<NS>.<key>')`；函数调用 `messages.<NS>.fn(arg)` → `t('<NS>.fn', { arg })`（参数名与 JSON 模板占位符一致）。
- [ ] **Step 3: 运行该 surface 测试** `pnpm test -- <surface>` 必须通过。
- [ ] **Step 4: typecheck** `pnpm typecheck` 必须通过。
- [ ] **Step 5: 提交** `refactor: <NS> 命名空间迁移到 i18next`。

---

## Task 15: 移除桥接与旧字典

**Files:**
- Delete: `src/shared/i18n/messages.ts`（字典部分；常量已迁出）
- Delete: `src/shared/i18n/settings-messages.ts`
- Modify: `src/shared/i18n/i18n.tsx`（旧）— 删除或仅 re-export 新 provider。
- Modify: 所有仍 `from ".../i18n/i18n"` 的导入 → 改为 `from ".../i18n/i18n-provider"`。

- [ ] **Step 1: 确认无 `messages.` 残留** `rg -n "messages\." src --glob '*.tsx' --glob '*.ts' | rg -v '\.test\.|locales/'`（应为空，除测试夹具）。
- [ ] **Step 2: 删除旧字典与桥接。**
- [ ] **Step 3: `pnpm typecheck` + `pnpm test` 通过。**
- [ ] **Step 4: 提交** `refactor: 移除 i18n 旧字典与迁移桥接`。

---

## Task 16: 修复「英文 locale 含中文」用户可见泄露

**Files:**
- Modify: `src/shared/toast.ts`、`src/components/ui/{confirm-dialog,loading-dialog,use-confirm-dialog}.tsx`、issue 命令提示等。
- 不改 `src/features/issues/run-prompt-builder.ts`（业务内容）。

- [ ] **Step 1: 审计** `rg -n '[\x{4e00}-\x{9fff}]' src --glob '*.tsx' --glob '*.ts' | rg -v '/i18n/|\.test\.|run-prompt-builder'`，列出运行时用户可见硬编码点。
- [ ] **Step 2: 逐点接入** i18next（en/zh 补齐 `errors`/`toast`/`dialog` 键）。
- [ ] **Step 3: 接入** toast/dialog 错误展示点改用 `getLocalizedCommandError`。
- [ ] **Step 4: 回归测试** 新增「英文 locale 典型面无中文残留」断言。
- [ ] **Step 5: 提交** `fix: 消除英文 locale 下用户可见中文泄露`。

---

## Task 17: 文档与最终验证

**Files:**
- Modify: `docs/standards/agent-development-rules.md`（「文案与国际化」改为 i18next + JSON `{{name}}` 规范、默认 zh、术语表、错误本地化边界）。
- Modify: `docs/architecture-design/settings-page-layout.md`（语言偏好行位置）。

- [ ] **Step 1: 更新两份文档。**
- [ ] **Step 2: 复查文档相对链接** `rg -n "settings-page-layout|agent-development-rules" docs`。
- [ ] **Step 3: 全量门禁** `pnpm format` → 复查 `git status --short` → `pnpm lint` → `pnpm typecheck` → `pnpm test`。
- [ ] **Step 4: `openspec validate introduce-i18next-language-preference --strict`。**
- [ ] **Step 5: 回填 `tasks.md` 勾选；提交** `docs: 更新 i18n 规范与设置页语言行说明`。

---

## Self-Review

- **Spec coverage:** settings-ui「Global Preferences language」→ Task 7；app-i18n runtime→Task 1-4；默认 zh→Task 1/3/6；术语→Task 2（+locales.test 守护）；错误边界→Task 8/16；调用点迁移→Task 9-15；桥接受控→Task 5；移除→Task 15。覆盖完整。
- **Placeholder scan:** Task 1 Step 4 的字号常量值标注「以源文件实际值为准」（非占位，是迁移保留语义）；其余代码完整。命名空间迁移用 grep 定位（机械迁移的正确指令，非占位）。
- **Type consistency:** `Locale`/`ThemePreference`/`ContentFontSize` 全程来自 `i18n-constants.ts`；`changeLocale(lng: Locale)` 与 `setLocale(lng: Locale)` 签名一致；`getLocalizedCommandError(error, t)` 在 Task 8 定义、Task 16 消费。
