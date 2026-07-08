/**
 * 项目首字母方块背景色板与取色逻辑。
 *
 * 设计取舍：RedWhisk 设计系统是极简黑白灰 token 体系，没有多色装饰 token；
 * 首字母方块需要多色用于视觉区分项目，因此在此维护一个独立的可区分色板，
 * 而不是强行复用极简 token。色相均匀分散、明度统一，白字字母在浅色与深色面板上都可读。
 *
 * 取色逻辑：DJB2 风格散列（乘 31 累加）混合 id、name、path，分布近似均匀；
 * 项目身份不变则颜色稳定，不随列表顺序波动。当颜色基数与项目数量接近时，
 * 仍可能因生日悖论出现撞色，因此色板保持足够大的数量（12 种）以降低撞色概率。
 */
export const PROJECT_ICON_COLORS = [
  "#2563eb", // 蓝
  "#0891b2", // 青
  "#16a34a", // 绿
  "#059669", // 翠
  "#65a30d", // 黄绿
  "#d97706", // 琥珀
  "#ea580c", // 橙
  "#dc2626", // 红
  "#e11d48", // 玫红
  "#7c3aed", // 紫
  "#4f46e5", // 靛
  "#475569", // 石板
] as const;

export interface ProjectIconColorInput {
  id: number;
  name: string;
  path: string;
}

/**
 * 根据项目身份生成稳定的首字母方块背景色。
 *
 * 同一个项目的 id、name、path 共同决定颜色，保证 Project Home 列表与
 * Project Switcher 两处渲染一致；只要项目身份不变，颜色不随渲染顺序变化。
 */
export function getProjectIconColor(project: ProjectIconColorInput): string {
  const source = `${project.id}:${project.name}:${project.path}`;
  let hash = 0;

  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return PROJECT_ICON_COLORS[hash % PROJECT_ICON_COLORS.length];
}
