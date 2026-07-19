/**
 * Rust 类型名 → TS interface 名映射。
 * 仅登记「名字不同但契约对应」的对；未登记的 Rust 类型要求 TS 侧存在同名 interface。
 */
export const rustToTsName: Record<string, string> = {
  // Rust 用 ProjectSummary（聚合 + codeWorkspaces），前端历史用 ProjectRecord 表示同一 IPC 负载。
  ProjectSummary: "ProjectRecord",
};

/**
 * Rust 侧存在、但前端不需要 mirror 的类型白名单（内部辅助 / 非跨边界 / 仅 Rust 内部消费）。
 * 初始为空，Task 4 根据首次对比结果登记。
 */
export const rustOnlyAllowlist: ReadonlySet<string> = new Set<string>([]);
