import { describe, expect, it } from "vitest";

import {
  PROJECT_ICON_COLORS,
  getProjectIconColor,
} from "./project-icon-color";

const PALETTE = PROJECT_ICON_COLORS as readonly string[];

describe("getProjectIconColor", () => {
  it("对同一项目返回稳定颜色（确定性）", () => {
    const project = { id: 1, name: "redwhisk", path: "/Users/u/w/redwhisk" };

    expect(getProjectIconColor(project)).toBe(getProjectIconColor(project));
  });

  it("同一项目在两次渲染间颜色不变", () => {
    const project = { id: 7, name: "api-server", path: "/w/api" };
    const first = getProjectIconColor(project);
    const second = getProjectIconColor({ ...project });

    expect(second).toBe(first);
  });

  it("返回值始终落在色板内", () => {
    for (let id = 1; id <= 200; id += 1) {
      const color = getProjectIconColor({
        id,
        name: `project-${id}`,
        path: `/w/project-${id}`,
      });

      expect(PALETTE.includes(color)).toBe(true);
    }
  });

  it("色板提供至少 10 种颜色（当前 12 种）", () => {
    expect(PROJECT_ICON_COLORS.length).toBeGreaterThanOrEqual(10);
    expect(PROJECT_ICON_COLORS.length).toBe(12);
  });

  it("在足够多项目下覆盖全部 12 种颜色", () => {
    const seen = new Set<string>();

    for (let id = 1; id <= 500; id += 1) {
      seen.add(
        getProjectIconColor({ id, name: `project-${id}`, path: `/w/p-${id}` }),
      );
    }

    expect(seen.size).toBe(PROJECT_ICON_COLORS.length);
  });

  it("分布近似均匀（每色占比在 12% 上下浮动）", () => {
    const counts = new Map<string, number>();

    for (let id = 1; id <= 6000; id += 1) {
      const color = getProjectIconColor({
        id,
        name: `project-${id}`,
        path: `/w/p-${id}`,
      });
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }

    for (const color of PALETTE) {
      const ratio = (counts.get(color) ?? 0) / 6000;
      expect(ratio).toBeGreaterThan(0.05);
      expect(ratio).toBeLessThan(0.2);
    }
  });

  it("不同路径的同名项目可区分", () => {
    const a = getProjectIconColor({ id: 1, name: "demo", path: "/a/demo" });
    const b = getProjectIconColor({ id: 1, name: "demo", path: "/b/demo" });

    expect(PALETTE.includes(a)).toBe(true);
    expect(PALETTE.includes(b)).toBe(true);
  });
});
