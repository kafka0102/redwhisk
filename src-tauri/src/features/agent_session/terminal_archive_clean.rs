//! TUI Issue Session 归档：结论向提取纯函数（ADR-0023 / ADR-0025）。
//! 无顶格用户 turn 时回退轻清理，避免完成归档写空。

const LATEST_OUTPUT_MAX_CHARS: usize = 500;

/// 对已剥离控制序列的终端文本做结论向提取：
/// - 保留真实用户输入块与每个用户 turn 之后的最后一段连续非过程正文
/// - 丢弃 chrome / 工具过程 / 首用户前残留 / 中间思考
/// - 按固定块间距排版（无 User/Assistant 标签）
/// - 若找不到顶格真实用户 turn，回退轻清理（去 spinner/Working、压空行），避免空归档
pub(crate) fn extract_tui_archive_conclusion_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().map(|line| line.trim_end()).collect();
    if lines.is_empty() {
        return String::new();
    }

    let user_starts: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| is_real_user_prompt_line(line).then_some(index))
        .collect();
    if user_starts.is_empty() {
        // Issue 初始 prompt 常被折叠为状态头；PTY 剥 CSI 后 › 也常粘在行中。
        // 结论提取前提（顶格 › 用户 turn）不成立时回退轻清理，避免完成归档写空。
        return light_clean_terminal_archive_text(&normalized);
    }

    let mut output_blocks: Vec<String> = Vec::new();
    for (turn_index, &user_start) in user_starts.iter().enumerate() {
        let turn_end = user_starts
            .get(turn_index + 1)
            .copied()
            .unwrap_or(lines.len());
        let (user_block, body_start) = extract_user_block(&lines, user_start, turn_end);
        if user_block.is_empty() {
            continue;
        }
        output_blocks.push(user_block);

        if let Some(conclusion) = extract_last_conclusion(&lines[body_start..turn_end]) {
            output_blocks.push(conclusion);
        }
    }

    join_blocks_with_spacing(&output_blocks)
}

/// 从提取后的纯文本取最后一条非空行（截断到与 timeline 摘要一致的长度上限）。
pub(crate) fn latest_output_from_archive_text(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(latest_line.chars().take(LATEST_OUTPUT_MAX_CHARS).collect())
}

fn extract_user_block(lines: &[&str], start: usize, turn_end: usize) -> (String, usize) {
    let mut last_content = start;
    let mut index = start + 1;
    while index < turn_end {
        let line = lines[index];
        if line.trim().is_empty() {
            index += 1;
            continue;
        }
        if is_user_continuation_line(line) {
            last_content = index;
            index += 1;
            continue;
        }
        break;
    }

    let block = format_block_lines(&lines[start..=last_content]);
    (block, last_content + 1)
}

fn extract_last_conclusion(body: &[&str]) -> Option<String> {
    let mut segments: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut in_tool_output = false;

    for raw_line in body {
        let line = strip_inline_chrome(raw_line);
        let trimmed = line.trim();

        if is_tool_start_line(trimmed) {
            finish_segment(&mut segments, &mut current);
            in_tool_output = true;
            continue;
        }

        if in_tool_output {
            if is_assistant_speech_line(trimmed) {
                in_tool_output = false;
            } else {
                // 工具输出区：空行、树、回显、chrome 一律丢弃
                continue;
            }
        }

        if trimmed.is_empty() {
            if !current.is_empty() {
                current.push(String::new());
            }
            continue;
        }

        // 装饰线/警告等过程噪声软丢弃：不打断正文段，避免结论内表格线把段落切碎
        if is_process_or_chrome_line(trimmed) {
            continue;
        }

        current.push(line);
    }
    finish_segment(&mut segments, &mut current);

    segments.into_iter().rev().find_map(|segment| {
        let refs: Vec<&str> = segment.iter().map(String::as_str).collect();
        let formatted = format_block_lines(&refs);
        if formatted.is_empty() {
            None
        } else {
            Some(formatted)
        }
    })
}

fn finish_segment(segments: &mut Vec<Vec<String>>, current: &mut Vec<String>) {
    if current.is_empty() {
        return;
    }
    segments.push(std::mem::take(current));
}

fn join_blocks_with_spacing(blocks: &[String]) -> String {
    blocks.join("\n\n")
}

fn format_block_lines(lines: &[&str]) -> String {
    let mut cleaned: Vec<String> = Vec::new();
    let mut blank_run = 0usize;

    for line in lines {
        let trimmed_end = line.trim_end();
        if trimmed_end.trim().is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
            cleaned.push(String::new());
            continue;
        }
        blank_run = 0;
        cleaned.push(trimmed_end.to_string());
    }

    while cleaned.first().is_some_and(|line| line.is_empty()) {
        cleaned.remove(0);
    }
    while cleaned.last().is_some_and(|line| line.is_empty()) {
        cleaned.pop();
    }

    cleaned.join("\n")
}

/// 无可用用户 turn 时的回退清理：去掉 spinner / Working 状态行，合并过多空行。
fn light_clean_terminal_archive_text(text: &str) -> String {
    let mut cleaned_lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;

    for line in text.lines() {
        let trimmed_end = line.trim_end();
        let trimmed = trimmed_end.trim();
        if !trimmed.is_empty()
            && (is_working_status_line(trimmed) || is_spinner_only_line(trimmed))
        {
            continue;
        }
        if trimmed.is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
            cleaned_lines.push(String::new());
            continue;
        }
        blank_run = 0;
        cleaned_lines.push(trimmed_end.to_string());
    }

    while cleaned_lines.first().is_some_and(|line| line.is_empty()) {
        cleaned_lines.remove(0);
    }
    while cleaned_lines.last().is_some_and(|line| line.is_empty()) {
        cleaned_lines.pop();
    }

    cleaned_lines.join("\n")
}

fn is_real_user_prompt_line(line: &str) -> bool {
    // 真用户 turn 顶格以 › 起笔；缩进 ›/> 或 shell 回显 `> cmd` 不计入
    if line.starts_with(' ') || line.starts_with('\t') {
        return false;
    }
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
    true
}

fn strip_user_prompt_prefix(line: &str) -> Option<&str> {
    // Codex TUI 用户提示符为 ›；不把 ASCII `>` 当作用户 turn（易与 shell/PS1 回显冲突）
    line.strip_prefix('›')
}

fn is_status_header_prompt(line: &str) -> bool {
    if let Some(idx) = line.rfind(" · ") {
        let after = line[idx + " · ".len()..].trim_start();
        if after.starts_with('~') || after.starts_with('/') {
            return true;
        }
    }
    line.contains("esc to interrupt")
}

fn is_user_continuation_line(line: &str) -> bool {
    if !(line.starts_with(' ') || line.starts_with('\t')) {
        return false;
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_process_or_chrome_line(trimmed)
        || is_tool_start_line(trimmed)
        || is_assistant_speech_line(trimmed)
    {
        return false;
    }
    if strip_user_prompt_prefix(trimmed).is_some() {
        return false;
    }
    true
}

fn is_tool_start_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("• Ran") || trimmed.starts_with("•Ran")
}

fn is_assistant_speech_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('•') && !is_tool_start_line(trimmed)
}

fn is_process_or_chrome_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_working_status_line(trimmed) || is_spinner_only_line(trimmed) {
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
    false
}

fn is_tree_output_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    matches!(
        trimmed.chars().next(),
        Some('│' | '└' | '├' | '┌' | '╭' | '╰' | '╮' | '╯')
    )
}

fn is_fold_line(line: &str) -> bool {
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

fn is_decorative_line(line: &str) -> bool {
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

fn contains_sticky_status_chrome(line: &str) -> bool {
    line.contains("esc to interrupt")
        || (line.contains("Working(") && line.contains('›'))
        || (line.contains("Working(") && line.contains(" · "))
}

fn strip_inline_chrome(line: &str) -> String {
    let mut cut = line.len();
    for marker in ["•Working(", " Working("] {
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
    line[..cut].trim_end().to_string()
}

fn is_working_status_line(line: &str) -> bool {
    let without_spinner = line
        .trim_start_matches(|c: char| is_braille_spinner_char(c) || c.is_whitespace() || c == '•');
    without_spinner.starts_with("Working(") && without_spinner.ends_with(')')
}

fn is_spinner_only_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| is_braille_spinner_char(c) || c.is_whitespace())
}

fn is_braille_spinner_char(c: char) -> bool {
    matches!(c, '\u{2800}'..='\u{28ff}')
}

#[cfg(test)]
#[path = "terminal_archive_clean_test.rs"]
mod tests;
