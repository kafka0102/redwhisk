//! TUI 归档结论向提取：多标记族行分类（Codex / Claude 等）。

pub(super) fn is_real_user_prompt_line(line: &str) -> bool {
    // 真用户 turn 以 › / ❯ 起笔。允许前导空白（Grok 等全屏 TUI 内容区常缩进）；
    // ASCII `>` shell 回显仍不计入（strip_user_prompt_prefix 不认 `>`）。
    let line = line.trim_start();
    let Some(rest) = strip_user_prompt_prefix(line) else {
        return false;
    };
    if rest.trim().is_empty() {
        return false;
    }
    if is_status_header_prompt(line) {
        return false;
    }
    if contains_sticky_status_chrome(line) {
        return false;
    }
    if !is_plausible_user_prompt_body(rest) {
        return false;
    }
    true
}

pub(super) fn is_plausible_user_prompt_body(rest: &str) -> bool {
    let trimmed = rest.trim();
    if trimmed.is_empty() {
        return false;
    }
    let has_cjk = trimmed.chars().any(is_cjk_char);
    if has_cjk {
        return true;
    }
    // 非中文：拒绝过短/残缺 prompt（如 Claude 收尾 "❯ (B"）
    let letter_count = trimmed.chars().filter(|c| c.is_ascii_alphabetic()).count();
    trimmed.chars().count() >= 4 && letter_count >= 2
}

pub(super) fn is_cjk_char(c: char) -> bool {
    matches!(
        c,
        '\u{4e00}'..='\u{9fff}'
            | '\u{3400}'..='\u{4dbf}'
            | '\u{f900}'..='\u{faff}'
            | '\u{3000}'..='\u{303f}'
    )
}

pub(super) fn strip_user_prompt_prefix(line: &str) -> Option<&str> {
    // Codex TUI：›；Claude Code TUI：❯。不把 ASCII `>` 当作用户 turn。
    line.strip_prefix('›')
        .or_else(|| line.strip_prefix('❯'))
}

pub(super) fn is_status_header_prompt(line: &str) -> bool {
    if let Some(idx) = line.rfind(" · ") {
        let after = line[idx + " · ".len()..].trim_start();
        if after.starts_with('~') || after.starts_with('/') {
            return true;
        }
    }
    line.contains("esc to interrupt")
}

pub(super) fn is_user_continuation_line(line: &str) -> bool {
    if !(line.starts_with(' ') || line.starts_with('\t')) {
        return false;
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_process_or_chrome_line(trimmed)
        || is_tool_start_line(trimmed)
        || is_assistant_speech_lead_line(trimmed)
    {
        return false;
    }
    if strip_user_prompt_prefix(trimmed).is_some() {
        return false;
    }
    true
}

pub(super) fn is_tool_start_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.starts_with("• Ran") || trimmed.starts_with("•Ran") {
        return true;
    }
    if trimmed.starts_with("• Running") || trimmed.starts_with("•Running") {
        return true;
    }
    // Claude Code：⏺Update(path) / ⏺Running… / ⏺Thinking…
    if let Some(rest) = strip_claude_bullet_prefix(trimmed) {
        let rest = rest.trim_start();
        if rest.starts_with("Update(")
            || rest.starts_with("Running")
            || rest.starts_with("Thinking")
            || rest.starts_with("Read(")
            || rest.starts_with("Write(")
            || rest.starts_with("Edit(")
            || rest.starts_with("Bash(")
            || rest.starts_with("Search(")
            || rest.starts_with("Grepping")
            || rest.starts_with("Reading")
            || rest.starts_with("Writing")
            || rest.starts_with("Searching")
        {
            return true;
        }
    }
    // 剥壳后粘连：Thought for 5s, ran 1 shell command / running1shellcommand
    if is_thought_timing_line(trimmed) {
        return true;
    }
    false
}

pub(super) fn strip_claude_bullet_prefix(line: &str) -> Option<&str> {
    line.strip_prefix('⏺')
        .or_else(|| line.strip_prefix('•'))
}

pub(super) fn is_assistant_speech_lead_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() || is_tool_start_line(trimmed) {
        return false;
    }
    if trimmed.starts_with('•') {
        return true;
    }
    if let Some(rest) = trimmed.strip_prefix('⏺') {
        let rest = rest.trim_start();
        return !rest.is_empty() && !is_tool_start_line(trimmed);
    }
    false
}


pub(super) fn is_process_or_chrome_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_working_status_line(trimmed) || is_spinner_only_line(trimmed) {
        return true;
    }
    if is_thinking_noise_line(trimmed) || is_thought_timing_line(trimmed) {
        return true;
    }
    if is_tool_start_line(trimmed) {
        return true;
    }
    if is_tree_output_line(trimmed) {
        return true;
    }
    if is_fold_line(trimmed) {
        return true;
    }
    if is_decorative_line(trimmed) {
        return true;
    }
    if trimmed.starts_with('⚠') || trimmed.starts_with("Warning:") {
        return true;
    }
    if trimmed.starts_with("Tip:") {
        return true;
    }
    if contains_sticky_status_chrome(trimmed) {
        return true;
    }
    if is_status_header_prompt(trimmed) {
        return true;
    }
    // Claude stop-hook / 状态碎片
    if trimmed.contains("Slithering") || trimmed.contains("Brewed for") {
        return true;
    }
    if trimmed.contains("stop hooks") {
        return true;
    }
    false
}

pub(super) fn is_thinking_noise_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("thinking") {
        // 纯 spinner/状态：8thinking / ✻thinking / thinking…
        let without_marks: String = trimmed
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
            .collect();
        let compact = without_marks.split_whitespace().collect::<String>().to_ascii_lowercase();
        if compact.contains("thinking") && compact.len() <= 24 {
            return true;
        }
        if trimmed.chars().count() <= 48 {
            return true;
        }
    }
    // 仅装饰符号 + 短碎片
    if trimmed.chars().count() <= 6
        && trimmed.chars().all(|c| {
            is_braille_spinner_char(c)
                || matches!(c, '✻' | '✶' | '✳' | '✢' | '✽' | '·' | '…' | '●' | '○')
                || c.is_whitespace()
        })
    {
        return true;
    }
    false
}

pub(super) fn is_thought_timing_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.starts_with("Thought for") || trimmed.starts_with("Thiking for") {
        return true;
    }
    // 粘连：Thought for 5s, ran 1 shell command / running1shellcommand…
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("thought for") && (lower.contains("ran") || lower.contains("running")) {
        return true;
    }
    if lower.contains("running") && lower.contains("shell") {
        return true;
    }
    if lower.contains("ran ") && lower.contains("shell command") {
        return true;
    }
    if lower.contains("committed ") && lower.contains("ran ") {
        return true;
    }
    false
}

pub(super) fn is_tree_output_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    matches!(
        trimmed.chars().next(),
        Some('│' | '└' | '├' | '┌' | '╭' | '╰' | '╮' | '╯' | '⎿')
    )
}

pub(super) fn is_fold_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.contains("ctrl + t") {
        return true;
    }
    for marker in ["… +", "... +", "…+", "...+"] {
        if let Some(idx) = trimmed.find(marker) {
            let after = &trimmed[idx + marker.len()..];
            if after.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

pub(super) fn is_decorative_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains("Worked for") {
        let bar_count = trimmed
            .chars()
            .filter(|c| matches!(*c, '─' | '━' | '-'))
            .count();
        if bar_count >= 3 {
            return true;
        }
    }
    let decorative = |c: char| {
        matches!(
            c,
            '─' | '━'
                | '═'
                | '|'
                | '-'
                | '_'
                | '•'
                | '·'
                | '█'
                | '░'
                | '▒'
                | '▓'
                | '╭'
                | '╮'
                | '╯'
                | '╰'
                | '┌'
                | '┐'
                | '┘'
                | '└'
                | '│'
                | '┼'
                | '├'
                | '┤'
                | '┬'
                | '┴'
                | ' '
        )
    };
    if !trimmed.chars().all(decorative) {
        return false;
    }
    let symbol_count = trimmed
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '•' && *c != '·')
        .count();
    symbol_count >= 3
}

pub(super) fn contains_sticky_status_chrome(line: &str) -> bool {
    line.contains("esc to interrupt")
        || (line.contains("Working(") && line.contains('›'))
        || (line.contains("Working(") && line.contains(" · "))
}

pub(super) fn strip_inline_chrome(line: &str) -> String {
    let mut cut = line.len();
    for marker in ["•Working(", " Working(", "•Running", " •Running"] {
        if let Some(idx) = line.find(marker) {
            cut = cut.min(idx);
        }
    }
    if let Some(idx) = line.find("Working(") {
        let prefix = &line[..idx];
        let sticky = prefix
            .chars()
            .rev()
            .take_while(|c| is_braille_spinner_char(*c) || c.is_whitespace() || *c == '•')
            .count()
            > 0
            || prefix.ends_with('•');
        if sticky {
            let sticky_start = prefix
                .char_indices()
                .rev()
                .find(|(_, c)| !(is_braille_spinner_char(*c) || c.is_whitespace() || *c == '•'))
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(0);
            cut = cut.min(sticky_start);
        }
    }
    // Codex sticky：结论后粘 status 头 `• 已完成。 › Use /skills ...`
    if let Some(idx) = line.find(" › ") {
        let prefix = line[..idx].trim_end();
        if !prefix.is_empty() {
            cut = cut.min(idx);
        }
    }
    line[..cut].trim_end().to_string()
}

pub(super) fn is_working_status_line(line: &str) -> bool {
    let without_spinner = line
        .trim_start_matches(|c: char| is_braille_spinner_char(c) || c.is_whitespace() || c == '•');
    without_spinner.starts_with("Working(") && without_spinner.ends_with(')')
}

pub(super) fn is_spinner_only_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| is_braille_spinner_char(c) || c.is_whitespace())
}

pub(super) fn is_braille_spinner_char(c: char) -> bool {
    matches!(c, '\u{2800}'..='\u{28ff}')
}

