//! 终端日志尾截断：保证截断点不落在 UTF-8 码点或 ANSI 转义序列中间。
//!
//! Codex 等 TUI 输出含大量 CSI/OSC。按固定字节裁剪时若切在 `\x1b[` 参数中间，
//! xterm 会把半截参数当普通字符渲染，表现为底部输入框/状态行短暂乱码；
//! 下一次完整重绘后又“自己好了”。

/// 向后搜寻未闭合 ESC 序列时的最大窗口（OSC 可能较长）。
const ESC_LOOKBACK_MAX: usize = 8_192;
/// 为完整包含跨边界 ESC 序列，允许 tail 略超 max_bytes 的上限。
const ESC_OVERFLOW_SLACK: usize = 4_096;

/// 计算「保留末尾不超过 max_bytes」时的安全起点（含）。
///
/// 规则：
/// 1. 内容不超限 → 0
/// 2. UTF-8：起点不得落在多字节码点中间
/// 3. ANSI：若起点落在未结束的 ESC 序列内，优先回退到该序列起点；
///    回退后体积过大则跳到该序列结束处（丢弃半截序列，避免可见乱码）
pub fn safe_terminal_log_tail_start(bytes: &[u8], max_bytes: usize) -> usize {
    if max_bytes == 0 || bytes.is_empty() {
        return bytes.len();
    }
    if bytes.len() <= max_bytes {
        return 0;
    }

    let mut start = bytes.len().saturating_sub(max_bytes);
    start = align_utf8_start(bytes, start);

    if let Some(esc_start) = find_open_escape_start(bytes, start) {
        match find_escape_end(bytes, esc_start) {
            Some(esc_end) if esc_end > start => {
                let include_len = bytes.len() - esc_start;
                if include_len <= max_bytes.saturating_add(ESC_OVERFLOW_SLACK) {
                    start = esc_start;
                } else {
                    start = align_utf8_start(bytes, esc_end);
                }
            }
            Some(_) => {
                // 序列在 cut 前已结束：保持当前 start
            }
            None => {
                // 序列直至 EOF 未闭合：纳入完整半截，避免后续 live 拼接时参数错位
                let include_len = bytes.len() - esc_start;
                if include_len <= max_bytes.saturating_add(ESC_OVERFLOW_SLACK) {
                    start = esc_start;
                }
            }
        }
    }

    start
}

/// 截取终端日志尾部字节（安全边界）。
pub fn take_terminal_log_tail(bytes: &[u8], max_bytes: usize) -> &[u8] {
    let start = safe_terminal_log_tail_start(bytes, max_bytes);
    &bytes[start..]
}

fn align_utf8_start(bytes: &[u8], mut start: usize) -> usize {
    while start < bytes.len() && is_utf8_continuation(bytes[start]) {
        start += 1;
    }
    start
}

fn is_utf8_continuation(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

/// 若 `cut` 落在某个从更早位置开始且尚未结束的 ESC 序列内，返回该序列起点。
fn find_open_escape_start(bytes: &[u8], cut: usize) -> Option<usize> {
    if cut == 0 || cut > bytes.len() {
        return None;
    }

    let window_start = cut.saturating_sub(ESC_LOOKBACK_MAX);
    let mut index = window_start;
    while index < cut {
        if bytes[index] != 0x1b {
            index += 1;
            continue;
        }
        match find_escape_end(bytes, index) {
            Some(end) if end <= cut => {
                index = end;
            }
            Some(_) | None => {
                // 序列跨越 cut 或直至数据末尾仍未结束
                return Some(index);
            }
        }
    }
    None
}

/// 返回从 `esc_start`（指向 ESC）开始的完整转义序列的结束下标（不含）。
/// 无法判定时返回 None。
fn find_escape_end(bytes: &[u8], esc_start: usize) -> Option<usize> {
    if esc_start >= bytes.len() || bytes[esc_start] != 0x1b {
        return None;
    }
    let next = esc_start + 1;
    if next >= bytes.len() {
        return None;
    }

    match bytes[next] {
        // CSI: ESC [
        b'[' => find_csi_end(bytes, next + 1),
        // OSC: ESC ]
        b']' => find_osc_end(bytes, next + 1),
        // DCS / SOS / PM / APC: ESC P / X / ^ / _
        b'P' | b'X' | b'^' | b'_' => find_st_terminated_end(bytes, next + 1),
        // 两字节独立 ESC 序列：ESC + final（0x40-0x7E），如 ESC M / ESC 7 / ESC 8
        final_byte if (0x40..=0x7e).contains(&final_byte) => Some(next + 1),
        _ => None,
    }
}

fn find_csi_end(bytes: &[u8], mut index: usize) -> Option<usize> {
    // 参数字节 0x30-0x3F，中间字节 0x20-0x2F，最终字节 0x40-0x7E
    while index < bytes.len() {
        let byte = bytes[index];
        if (0x40..=0x7e).contains(&byte) {
            return Some(index + 1);
        }
        if (0x20..=0x3f).contains(&byte) {
            index += 1;
            continue;
        }
        // 非法字节：视为序列在此中断
        return Some(index);
    }
    None
}

fn find_osc_end(bytes: &[u8], mut index: usize) -> Option<usize> {
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == 0x07 {
            // BEL
            return Some(index + 1);
        }
        if byte == 0x1b {
            if index + 1 < bytes.len() && bytes[index + 1] == b'\\' {
                // ST = ESC \
                return Some(index + 2);
            }
            // 新的 ESC 打断当前 OSC
            return Some(index);
        }
        index += 1;
    }
    None
}

fn find_st_terminated_end(bytes: &[u8], mut index: usize) -> Option<usize> {
    while index < bytes.len() {
        if bytes[index] == 0x1b {
            if index + 1 < bytes.len() && bytes[index + 1] == b'\\' {
                return Some(index + 2);
            }
            return Some(index);
        }
        if bytes[index] == 0x07 {
            return Some(index + 1);
        }
        index += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{safe_terminal_log_tail_start, take_terminal_log_tail};

    #[test]
    fn short_content_starts_at_zero() {
        let bytes = b"hello";
        assert_eq!(safe_terminal_log_tail_start(bytes, 100), 0);
        assert_eq!(take_terminal_log_tail(bytes, 100), bytes);
    }

    #[test]
    fn plain_ascii_tail_keeps_max_bytes() {
        let bytes = b"0123456789abcdef";
        let start = safe_terminal_log_tail_start(bytes, 8);
        assert_eq!(start, 8);
        assert_eq!(take_terminal_log_tail(bytes, 8), b"89abcdef");
    }

    #[test]
    fn does_not_cut_inside_utf8_multibyte() {
        // "ab" + 你(E4 BD A0) + "cd"
        let bytes = b"ab\xE4\xBD\xA0cd";
        // max_bytes=4 可能落在 E4 BD | A0 cd 之间
        let start = safe_terminal_log_tail_start(bytes, 4);
        assert!(
            !is_utf8_continuation_public(bytes[start]),
            "start={start} byte={:02x}",
            bytes[start]
        );
        let tail = take_terminal_log_tail(bytes, 4);
        assert!(std::str::from_utf8(tail).is_ok(), "tail={tail:?}");
    }

    #[test]
    fn does_not_cut_inside_csi_parameters() {
        // prefix + CSI 38;2;231;231;231m + text
        let mut bytes = b"PREFIX_".to_vec();
        bytes.extend_from_slice(b"\x1b[38;2;231;231;231mCOLORED\x1b[0m");
        bytes.extend_from_slice(b"_SUFFIX");

        let csi_at = bytes.iter().position(|b| *b == 0x1b).expect("esc");
        // 切在 "231;231" 中间
        let cut_from_end = bytes.len() - (csi_at + 10);
        let start = safe_terminal_log_tail_start(&bytes, cut_from_end);
        assert!(
            start <= csi_at,
            "expected rewind to ESC or before, start={start} csi_at={csi_at}"
        );
        let tail = take_terminal_log_tail(&bytes, cut_from_end);
        assert!(
            tail.windows(4).any(|w| w == b"\x1b[38"),
            "tail should include full CSI start: {tail:?}"
        );
        assert!(
            !tail.starts_with(b"1;231"),
            "tail must not start mid-parameter: {tail:?}"
        );
    }

    #[test]
    fn real_codex_log_tail_does_not_start_mid_csi() {
        let path = std::path::Path::new(
            "/Users/yujianjia/.redwhisk/session-logs/runtime/project-2/issue-228-profile-6-1784597512955.log",
        );
        if !path.exists() {
            // 本机诊断日志不在 CI 环境时跳过
            return;
        }
        let bytes = std::fs::read(path).expect("read log");
        for max_bytes in [32_768usize, 256 * 1024, 1024 * 1024] {
            let start = safe_terminal_log_tail_start(&bytes, max_bytes);
            if start == 0 {
                continue;
            }
            // 起点不应是 CSI 参数/中间字节（数字或分号），除非它不是半截序列
            if start < bytes.len() {
                // 若前一字节处于 ESC 序列内且未结束，算法应已回退
                assert!(
                    find_open_escape_start_pub(&bytes, start).is_none(),
                    "max_bytes={max_bytes} still open ESC at start={start}"
                );
            }
        }
    }

    fn is_utf8_continuation_public(byte: u8) -> bool {
        byte & 0b1100_0000 == 0b1000_0000
    }

    fn find_open_escape_start_pub(bytes: &[u8], cut: usize) -> Option<usize> {
        super::find_open_escape_start(bytes, cut)
    }
}
