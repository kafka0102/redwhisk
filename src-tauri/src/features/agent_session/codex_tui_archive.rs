//! TUI + Codex Issue 归档：以 Codex provider session log 摘要逐 turn 排版。
//!
//! 见 ADR-0045（取代 ADR-0025 对 Codex TUI 的降级结论）：`display_mode=tui` 且
//! `agent_type=codex` 的会话优先以本机 session log 为事实源，逐 turn 输出
//! 「用户输入块 + 结论块」；定位或解析失败时返回 `None`，由调用方回退既有
//! PTY 提取路径。`json` 与其它 agentType 不经过本模块。

use std::path::Path;

use crate::types::agent_profile::AgentType;

use super::codex_session_log::{read_codex_session_summary, CodexSessionSummary};

/// TUI Codex 归档的可选事实源上下文：session log 定位所需的三项始终结伴传递。
///
/// 任一项缺失即返回 `None`，由调用方回退既有 PTY 提取路径。
#[derive(Clone, Copy)]
pub(crate) struct TuiSessionLogSource<'a> {
    pub(crate) agent_type: Option<&'a AgentType>,
    pub(crate) provider_session_id: Option<&'a str>,
    pub(crate) codex_home: Option<&'a Path>,
    /// TUI 进程工作目录。Grok 会话存储按它编码目录名；Codex 不用。
    pub(crate) session_cwd: Option<&'a Path>,
    /// Grok 会话存储根。生产为 `~/.grok/sessions`；测试传入临时目录。
    pub(crate) grok_sessions_root: Option<&'a Path>,
    /// Claude 本机会话根。生产为 `~/.claude/projects`；测试传入临时目录。
    pub(crate) claude_projects_root: Option<&'a Path>,
    /// OpenCode sqlite。生产为 `~/.local/share/opencode/opencode.db`；测试传入临时库。
    pub(crate) opencode_db_path: Option<&'a Path>,
}

impl<'a> TuiSessionLogSource<'a> {
    /// `provider_session_id` / `codex_home` 缺失或 `agent_type` 非 Codex 时归档走 PTY 提取。
    pub(crate) fn new(
        agent_type: Option<&'a AgentType>,
        provider_session_id: Option<&'a str>,
        codex_home: Option<&'a Path>,
    ) -> Self {
        Self {
            agent_type,
            provider_session_id,
            codex_home,
            session_cwd: None,
            grok_sessions_root: None,
            claude_projects_root: None,
            opencode_db_path: None,
        }
    }

    /// Grok TUI 完成归档的会话目录与存储根。缺任一项则回退终端提取。
    pub(crate) fn with_grok_session(
        mut self,
        session_cwd: Option<&'a Path>,
        grok_sessions_root: Option<&'a Path>,
    ) -> Self {
        self.session_cwd = session_cwd;
        self.grok_sessions_root = grok_sessions_root;
        self
    }

    /// Claude Code 本机会话根。缺 cwd 或根目录则回退终端提取。
    pub(crate) fn with_claude_projects(
        mut self,
        session_cwd: Option<&'a Path>,
        claude_projects_root: Option<&'a Path>,
    ) -> Self {
        self.session_cwd = session_cwd;
        self.claude_projects_root = claude_projects_root;
        self
    }

    /// OpenCode 本机会话库。缺 cwd 或库路径则回退终端提取。
    pub(crate) fn with_opencode_db(
        mut self,
        session_cwd: Option<&'a Path>,
        opencode_db_path: Option<&'a Path>,
    ) -> Self {
        self.session_cwd = session_cwd;
        self.opencode_db_path = opencode_db_path;
        self
    }
}

/// 仅在 Codex 且能定位并解析 session log 时返回归档正文；否则 `None`。
pub(super) fn codex_session_archive_text(source: TuiSessionLogSource<'_>) -> Option<String> {
    if source.agent_type != Some(&AgentType::Codex) {
        return None;
    }
    let provider_session_id = source.provider_session_id?;
    if provider_session_id.trim().is_empty() {
        return None;
    }
    let summary = read_codex_session_summary(source.codex_home?, provider_session_id)?;
    let text = render_session_summary_text(&summary);
    (!text.is_empty()).then_some(text)
}

/// 逐 turn 输出用户块与结论块；块间与 turn 间各空一行（无 User/Assistant 标签）。
fn render_session_summary_text(summary: &CodexSessionSummary) -> String {
    let mut blocks: Vec<String> = Vec::new();
    for turn in &summary.turns {
        push_normalized_block(&mut blocks, &turn.user_text);
        if let Some(conclusion) = turn.final_assistant_text.as_deref() {
            push_normalized_block(&mut blocks, conclusion);
        }
    }
    blocks.join("\n\n")
}

fn push_normalized_block(blocks: &mut Vec<String>, text: &str) {
    let normalized = normalize_archive_block(text);
    if !normalized.is_empty() {
        blocks.push(normalized);
    }
}

/// 去交付用 `<issue-comment>` 标签，块内连续空行压到一行。
///
/// 有意保留行尾空白（含 Markdown 两空格硬换行），故不复用
/// `terminal_archive_clean::finalize_archive_text`——后者会 trim 行尾。
pub(super) fn normalize_archive_block(text: &str) -> String {
    let without_tags = text
        .replace("<issue-comment>", "")
        .replace("</issue-comment>", "");

    let mut lines: Vec<&str> = Vec::new();
    let mut blank_run = 0usize;
    for line in without_tags.lines() {
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
            lines.push("");
            continue;
        }
        blank_run = 0;
        lines.push(line);
    }

    while lines.first().is_some_and(|line| line.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}
