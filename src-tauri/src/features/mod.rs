// 业务纵切：原 core/ 业务模块 + 对应 commands 按前端 surface 重组。
// 详见 docs/architecture-design/backend-feature-first-refactor.md 与 ADR-0013。

pub mod agent_session;
pub mod app_update;
pub mod code_language;
pub mod issue;
pub mod project;
pub mod project_terminal;
pub mod settings;
