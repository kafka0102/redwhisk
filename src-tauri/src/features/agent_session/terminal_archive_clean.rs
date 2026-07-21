//! TUI Issue Session 归档：终端 transcript 轻清理纯函数（ADR-0023）。

const LATEST_OUTPUT_MAX_CHARS: usize = 500;

/// 对已剥离控制序列的终端文本做归档用轻清理：
/// - 归一化 CR
/// - 去掉 spinner 递进残片、`Working(...)` 类状态行
/// - 合并过多连续空行
/// - 保留命令输出与正文段落
pub(crate) fn light_clean_terminal_archive_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut cleaned_lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;

    for line in normalized.lines() {
        let trimmed_end = line.trim_end();
        if should_drop_terminal_archive_line(trimmed_end) {
            continue;
        }

        if trimmed_end.is_empty() {
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

    while cleaned_lines
        .last()
        .is_some_and(|line| line.is_empty())
    {
        cleaned_lines.pop();
    }
    while cleaned_lines
        .first()
        .is_some_and(|line| line.is_empty())
    {
        cleaned_lines.remove(0);
    }

    cleaned_lines.join("\n")
}

/// 从轻清理后的纯文本取最后一条非空行（截断到与 timeline 摘要一致的长度上限）。
pub(crate) fn latest_output_from_cleaned_archive_text(text: &str) -> Option<String> {
    let latest_line = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(latest_line.chars().take(LATEST_OUTPUT_MAX_CHARS).collect())
}

fn should_drop_terminal_archive_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    if is_working_status_line(trimmed) {
        return true;
    }

    if is_spinner_only_line(trimmed) {
        return true;
    }

    false
}

fn is_working_status_line(line: &str) -> bool {
    let without_spinner = line
        .trim_start_matches(|c: char| is_braille_spinner_char(c) || c.is_whitespace());
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
    matches!(
        c,
        '\u{2800}'..='\u{28ff}'
    )
}

#[cfg(test)]
mod tests {
    use super::{light_clean_terminal_archive_text, latest_output_from_cleaned_archive_text};

    #[test]
    fn light_clean_drops_spinner_fragments_working_status_and_extra_blanks() {
        let input = "\
$ ls
file.txt

\u{280b} Working(on it...)
\u{2819} Working(on it...)
\u{2819}

file.txt listed

Conclusion: done.


extra blank above
";
        let cleaned = light_clean_terminal_archive_text(input);

        assert!(
            !cleaned.contains("Working("),
            "应去掉 Working(...) 状态行: {cleaned:?}"
        );
        assert!(
            !cleaned.chars().any(is_braille_spinner),
            "应去掉 spinner 残片: {cleaned:?}"
        );
        assert!(cleaned.contains("$ ls"), "应保留命令: {cleaned:?}");
        assert!(
            cleaned.contains("file.txt listed"),
            "应保留输出: {cleaned:?}"
        );
        assert!(
            cleaned.contains("Conclusion: done."),
            "应保留正文: {cleaned:?}"
        );
        assert!(!cleaned.contains("\n\n\n"), "应合并过多空行: {cleaned:?}");
        assert_eq!(
            latest_output_from_cleaned_archive_text(&cleaned).as_deref(),
            Some("extra blank above")
        );
    }

    #[test]
    fn light_clean_normalizes_cr_and_keeps_plain_paragraphs() {
        let input = "line one\r\nline two\rline three\n";
        let cleaned = light_clean_terminal_archive_text(input);
        assert_eq!(cleaned, "line one\nline two\nline three");
    }

    fn is_braille_spinner(c: char) -> bool {
        matches!(
            c,
            '\u{280b}'
                | '\u{2819}'
                | '\u{2839}'
                | '\u{2838}'
                | '\u{283c}'
                | '\u{2834}'
                | '\u{2826}'
                | '\u{2827}'
                | '\u{2807}'
                | '\u{280f}'
        )
    }
}
