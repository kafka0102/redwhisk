## Deferred from: code review of 1-5-create-and-edit-local-issue (2026-06-05)

- 新增 Issue UI 文案绕过 i18n 字典。原因：Story 1.9 负责基础 i18n，目前仓库尚无 `shared/i18n` 运行时字典。
- 新增跨边界 Issue TypeScript DTO 仍为手写副本。原因：当前仓库尚无 Rust serde 到 TypeScript 的 generated-types pipeline；应在类型生成基础设施落地后统一迁移。
