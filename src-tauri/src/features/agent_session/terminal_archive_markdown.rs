//! TUI 归档 Markdown 标签 → 普通文本（写侧与归档读侧共用）。
//! 不解析完整 CommonMark，只处理回看噪声最大的子集。

/// 将归档正文中的常见 Markdown / 交付标签转为普通文本（保留语义内容，去掉标记）。
///
/// 用于 TUI 归档写侧与归档读侧（存量 `.log` 回看）。不解析完整 CommonMark，
/// 只处理回看噪声最大的子集：标题、加粗/斜体、行内代码、围栏、链接、`issue-comment` 标签。
pub(crate) fn markdown_labels_to_plain_text(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }

    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out_lines: Vec<String> = Vec::new();
    let mut in_fence = false;

    for line in normalized.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            out_lines.push(line.to_string());
            continue;
        }

        let without_tags = strip_issue_comment_tags(line);
        let without_heading = strip_atx_heading_markers(&without_tags);
        let plain_inline = strip_inline_markdown(&without_heading);
        out_lines.push(plain_inline);
    }

    // 折叠因去掉 fence / 空标签行产生的首尾空行，中间最多保留一个空行。
    collapse_blank_lines(&out_lines)
}

fn strip_issue_comment_tags(line: &str) -> String {
    line.replace("<issue-comment>", "")
        .replace("</issue-comment>", "")
}

fn strip_atx_heading_markers(line: &str) -> String {
    let trimmed_start = line.trim_start();
    let leading_ws_len = line.len() - trimmed_start.len();
    let leading_ws = &line[..leading_ws_len];

    // 可选列表前缀（• / - / * / 数字.）后接 ATX 标题时一并处理。
    let (list_prefix, after_list) = split_optional_list_prefix(trimmed_start);
    let heading_body = after_list.trim_start();
    let hashes = heading_body.chars().take_while(|c| *c == '#').count();
    if (1..=6).contains(&hashes) {
        let after_all_hashes = heading_body.get(hashes..).unwrap_or("");
        if after_all_hashes.is_empty()
            || after_all_hashes.starts_with(' ')
            || after_all_hashes.starts_with('\t')
        {
            let title = after_all_hashes.trim_start();
            return format!("{leading_ws}{list_prefix}{title}");
        }
    }
    line.to_string()
}

fn split_optional_list_prefix(line: &str) -> (&str, &str) {
    for prefix in ["• ", "•", "- ", "* ", "– ", "— "] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return (prefix, rest);
        }
    }
    // 有序：`1. ` / `12. `
    let bytes = line.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i > 0 && i + 1 < bytes.len() && bytes[i] == b'.' && bytes[i + 1] == b' ' {
        return (&line[..=i + 1], &line[i + 2..]);
    }
    ("", line)
}

fn strip_inline_markdown(line: &str) -> String {
    let mut result = line.to_string();
    // 图片 ![alt](url) → alt
    result = replace_markdown_links(&result, true);
    // 链接 [label](url) → label
    result = replace_markdown_links(&result, false);
    // 行内代码 `code` → code（不跨多段，逐对）
    result = strip_paired_delimiters(&result, '`');
    // 加粗 **text** / __text__。不剥单 * / _，避免误伤 snake_case、列表符与乘法。
    result = strip_wrapped_marker(&result, "**");
    result = strip_wrapped_marker(&result, "__");
    result
}

fn replace_markdown_links(input: &str, image: bool) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if image && chars[i] == '!' && i + 1 < chars.len() && chars[i + 1] == '[' {
            if let Some((label, next)) = parse_md_link_label_and_url(&chars, i + 1) {
                out.push_str(&label);
                i = next;
                continue;
            }
        }
        if !image && chars[i] == '[' {
            if let Some((label, next)) = parse_md_link_label_and_url(&chars, i) {
                out.push_str(&label);
                i = next;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn parse_md_link_label_and_url(chars: &[char], open_bracket: usize) -> Option<(String, usize)> {
    if open_bracket >= chars.len() || chars[open_bracket] != '[' {
        return None;
    }
    let mut j = open_bracket + 1;
    while j < chars.len() && chars[j] != ']' {
        // 标签内不允许裸换行
        if chars[j] == '\n' {
            return None;
        }
        j += 1;
    }
    if j >= chars.len() {
        return None;
    }
    let label: String = chars[open_bracket + 1..j].iter().collect();
    let after_label = j + 1;
    if after_label >= chars.len() || chars[after_label] != '(' {
        return None;
    }
    let mut k = after_label + 1;
    while k < chars.len() && chars[k] != ')' {
        if chars[k] == '\n' {
            return None;
        }
        k += 1;
    }
    if k >= chars.len() {
        return None;
    }
    Some((label, k + 1))
}

fn strip_paired_delimiters(input: &str, delimiter: char) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == delimiter {
            if let Some(close) = chars[i + 1..]
                .iter()
                .position(|&c| c == delimiter)
                .map(|p| i + 1 + p)
            {
                // 空 pair 或跨空白仅 delimiter 时仍剥掉标记
                for ch in &chars[i + 1..close] {
                    out.push(*ch);
                }
                i = close + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn strip_wrapped_marker(input: &str, marker: &str) -> String {
    if marker.is_empty() || !input.contains(marker) {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find(marker) {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + marker.len()..];
        if let Some(end) = after_open.find(marker) {
            let inner = &after_open[..end];
            // 拒绝空内容或跨行的包裹，避免误伤
            if inner.is_empty() || inner.contains('\n') {
                out.push_str(marker);
                rest = after_open;
                continue;
            }
            out.push_str(inner);
            rest = &after_open[end + marker.len()..];
        } else {
            out.push_str(marker);
            rest = after_open;
        }
    }
    out.push_str(rest);
    out
}


fn collapse_blank_lines(lines: &[String]) -> String {
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


#[cfg(test)]
#[path = "terminal_archive_markdown_test.rs"]
mod tests;
