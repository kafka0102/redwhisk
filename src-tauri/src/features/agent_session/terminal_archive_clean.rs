//! TUI Issue Session 归档：结论向提取纯函数（ADR-0023 / ADR-0025）。
//! 多标记族（Codex / Claude 等）启发式；无顶格用户 turn 时提取全会话最后结论，
//! 仍空则增强轻清理，避免完成归档写空。

const LATEST_OUTPUT_MAX_CHARS: usize = 500;

#[path = "terminal_archive_clean_classify.rs"]
mod terminal_archive_clean_classify;
use terminal_archive_clean_classify::*;


/// 对已剥离控制序列的终端文本做结论向提取：
/// - 保留真实用户输入块与每个用户 turn 之后的最后一段连续非过程正文
/// - 丢弃 chrome / 工具过程 / 首用户前残留 / 中间思考与旁白
/// - 按固定块间距排版（无 User/Assistant 标签）
/// - 若找不到顶格真实用户 turn：全会话最后结论；仍空则轻清理回退
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
        if let Some(conclusion) = extract_last_conclusion(&lines) {
            return conclusion;
        }
        // 无助手正文可抽时回退轻清理，避免完成归档写空。
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

    if output_blocks.is_empty() {
        if let Some(conclusion) = extract_last_conclusion(&lines) {
            return conclusion;
        }
        return light_clean_terminal_archive_text(&normalized);
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
    let mut in_speech = false;

    for raw_line in body {
        let line = strip_inline_chrome(raw_line);
        let trimmed = line.trim();

        if is_tool_start_line(trimmed) {
            finish_segment(&mut segments, &mut current);
            in_tool_output = true;
            in_speech = false;
            continue;
        }

        if in_tool_output {
            if is_assistant_speech_lead_line(trimmed) {
                in_tool_output = false;
            } else {
                // 工具输出区：空行、树、回显、chrome 一律丢弃
                continue;
            }
        }

        if trimmed.is_empty() {
            if in_speech && !current.is_empty() {
                current.push(String::new());
            }
            continue;
        }

        // 装饰线/警告等过程噪声软丢弃：不打断正文段，避免结论内表格线把段落切碎
        if is_process_or_chrome_line(trimmed) {
            continue;
        }

        if is_assistant_speech_lead_line(trimmed) {
            // 每一段助手开头发言单独成段，便于只保留最后结论、丢掉中间旁白
            finish_segment(&mut segments, &mut current);
            in_speech = true;
            current.push(line);
            continue;
        }

        // 仅在助手发言段内吸收续行（列表、验证段落等）
        if in_speech {
            current.push(line);
        }
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

/// 无可用结论时的回退清理：去掉 spinner / Working / 多标记族过程行，合并过多空行。
fn light_clean_terminal_archive_text(text: &str) -> String {
    let mut cleaned_lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;

    for line in text.lines() {
        let trimmed_end = line.trim_end();
        let trimmed = trimmed_end.trim();
        if !trimmed.is_empty()
            && (is_working_status_line(trimmed)
                || is_spinner_only_line(trimmed)
                || is_thinking_noise_line(trimmed)
                || is_tool_start_line(trimmed)
                || is_tree_output_line(trimmed)
                || is_fold_line(trimmed)
                || is_process_or_chrome_line(trimmed))
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


#[cfg(test)]
#[path = "terminal_archive_clean_test.rs"]
mod tests;
