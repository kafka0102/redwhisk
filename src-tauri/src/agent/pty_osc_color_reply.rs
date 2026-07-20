//! PTY 侧即时应答 OSC 10/11/12 颜色查询。
//!
//! Codex / Claude 等 TUI 启动时会发 `OSC 11 ; ?` 探测默认背景色，再据此把底部
//! composer 画成「略亮于背景」的 truecolor 条带。若无人应答，composer 会退回
//! 默认背景（`SGR 49`），与输出区完全同色，输入框边界不可辨。
//!
//! Agent Session TUI 常在前端 xterm 挂载 / restore 之前就完成首次查询；restore
//! 期间前端还会抑制 onData→PTY 转发（避免历史里的查询被二次应答成乱码），因此
//! 仅靠 xterm 应答不可靠。本模块在 PTY reader 路径上就地应答，不依赖前端。

use super::pty_session_manager::TerminalBackgroundTheme;

/// 与前端 `getTerminalTheme` 对齐的默认前景 / 背景 / 光标色（sRGB 8-bit）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalOscColors {
    pub foreground: (u8, u8, u8),
    pub background: (u8, u8, u8),
    pub cursor: (u8, u8, u8),
}

impl TerminalBackgroundTheme {
    /// OSC 10/11/12 应答使用的主题色。必须与 `src/features/terminals/terminal-theme.ts` 同步。
    pub fn osc_colors(self) -> TerminalOscColors {
        match self {
            TerminalBackgroundTheme::Dark => TerminalOscColors {
                // 略抬升 dark 背景，避免 Codex 在近纯黑上只给出仍接近黑的 composer。
                foreground: (0xf2, 0xf3, 0xf5),
                background: (0x1f, 0x20, 0x22),
                cursor: (0xf5, 0xf5, 0xf5),
            },
            TerminalBackgroundTheme::Light => TerminalOscColors {
                foreground: (0x16, 0x15, 0x15),
                background: (0xff, 0xff, 0xff),
                cursor: (0x16, 0x15, 0x15),
            },
        }
    }
}

/// 跨 read chunk 拼接的残片缓冲（OSC 查询最长约十余字节）。
#[derive(Debug, Default)]
pub struct OscColorQueryScanner {
    pending: Vec<u8>,
}

impl OscColorQueryScanner {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    /// 扫描本 chunk（含上次残片），返回应写回 PTY 的 OSC 颜色应答（可能多条）。
    pub fn push(&mut self, chunk: &[u8], theme: TerminalBackgroundTheme) -> Vec<u8> {
        if self.pending.is_empty() && chunk.is_empty() {
            return Vec::new();
        }

        let mut input = std::mem::take(&mut self.pending);
        input.extend_from_slice(chunk);

        let colors = theme.osc_colors();
        let mut replies = Vec::new();
        let mut i = 0usize;

        while i < input.len() {
            if input[i] != 0x1b {
                i += 1;
                continue;
            }

            match try_consume_osc_color_query(&input[i..]) {
                OscQueryParse::Complete { code, len } => {
                    if let Some(reply) = build_osc_color_reply(code, colors) {
                        replies.extend_from_slice(&reply);
                    }
                    i += len;
                }
                OscQueryParse::Incomplete => {
                    self.pending = input[i..].to_vec();
                    break;
                }
                OscQueryParse::NotQuery => {
                    i += 1;
                }
            }
        }

        replies
    }
}

enum OscQueryParse {
    Complete { code: u8, len: usize },
    Incomplete,
    NotQuery,
}

fn try_consume_osc_color_query(bytes: &[u8]) -> OscQueryParse {
    if bytes.is_empty() {
        return OscQueryParse::Incomplete;
    }
    if bytes[0] != 0x1b {
        return OscQueryParse::NotQuery;
    }
    if bytes.len() == 1 {
        return OscQueryParse::Incomplete;
    }
    if bytes[1] != b']' {
        return OscQueryParse::NotQuery;
    }

    // ESC ]
    let rest = &bytes[2..];
    if rest.is_empty() {
        return OscQueryParse::Incomplete;
    }

    // 需要 "10;?" / "11;?" / "12;?" + 终止符
    let code = match rest.first() {
        Some(b'1') => {
            if rest.len() == 1 {
                return OscQueryParse::Incomplete;
            }
            match rest.get(1) {
                Some(b'0') => 10u8,
                Some(b'1') => 11u8,
                Some(b'2') => 12u8,
                Some(_) => return OscQueryParse::NotQuery,
                None => return OscQueryParse::Incomplete,
            }
        }
        Some(_) => return OscQueryParse::NotQuery,
        None => return OscQueryParse::Incomplete,
    };

    // after "1X"
    let after_code = &rest[2..];
    if after_code.is_empty() {
        return OscQueryParse::Incomplete;
    }
    if after_code[0] != b';' {
        return OscQueryParse::NotQuery;
    }
    if after_code.len() == 1 {
        return OscQueryParse::Incomplete;
    }
    if after_code[1] != b'?' {
        return OscQueryParse::NotQuery;
    }

    // terminator
    let after_q = &after_code[2..];
    if after_q.is_empty() {
        return OscQueryParse::Incomplete;
    }
    if after_q[0] == 0x07 {
        // ESC ] 1X ; ? BEL  => 2 + 2 + 1 + 1 + 1 = 7? 
        // ESC ] + "10;?" + BEL = 2 + 4 + 1 = 7
        return OscQueryParse::Complete { code, len: 7 };
    }
    if after_q[0] == 0x1b {
        if after_q.len() == 1 {
            return OscQueryParse::Incomplete;
        }
        if after_q[1] == b'\\' {
            // ESC ] "10;?" ESC \ = 2 + 4 + 2 = 8
            return OscQueryParse::Complete { code, len: 8 };
        }
        return OscQueryParse::NotQuery;
    }
    OscQueryParse::NotQuery
}

fn build_osc_color_reply(code: u8, colors: TerminalOscColors) -> Option<Vec<u8>> {
    let rgb = match code {
        10 => colors.foreground,
        11 => colors.background,
        12 => colors.cursor,
        _ => return None,
    };
    Some(format_osc_color_reply(code, rgb))
}

/// 生成与 xterm.js `toRgbString(..., 16)` 一致的 OSC 颜色应答（ST 结尾）。
pub fn format_osc_color_reply(code: u8, (r, g, b): (u8, u8, u8)) -> Vec<u8> {
    // 16-bit 通道：把 8-bit 字节复制到高低位，与 xterm.js pad(channel, 16) 一致。
    let (rr, gg, bb) = (
        format!("{r:02x}{r:02x}"),
        format!("{g:02x}{g:02x}"),
        format!("{b:02x}{b:02x}"),
    );
    format!("\x1b]{code};rgb:{rr}/{gg}/{bb}\x1b\\").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_osc_11_query_with_dark_background() {
        let mut scanner = OscColorQueryScanner::new();
        let replies = scanner.push(b"\x1b]11;?\x07", TerminalBackgroundTheme::Dark);
        let expected = format_osc_color_reply(11, (0x1f, 0x20, 0x22));
        assert_eq!(replies, expected);
    }

    #[test]
    fn answers_osc_10_and_12_in_startup_probe_burst() {
        // 对齐 Codex 启动探测：OSC 10 + OSC 11 + 其它序列混杂。
        let mut scanner = OscColorQueryScanner::new();
        let burst = b"\x1b[6n\x1b]10;?\x07\x1b]11;?\x07\x1b[c";
        let replies = scanner.push(burst, TerminalBackgroundTheme::Dark);
        let mut expected = format_osc_color_reply(10, (0xf2, 0xf3, 0xf5));
        expected.extend(format_osc_color_reply(11, (0x1f, 0x20, 0x22)));
        assert_eq!(replies, expected);
    }

    #[test]
    fn answers_st_terminated_query() {
        let mut scanner = OscColorQueryScanner::new();
        let replies = scanner.push(b"\x1b]11;?\x1b\\", TerminalBackgroundTheme::Light);
        assert_eq!(replies, format_osc_color_reply(11, (0xff, 0xff, 0xff)));
    }

    #[test]
    fn stitches_fragmented_query_across_chunks() {
        let mut scanner = OscColorQueryScanner::new();
        assert!(scanner
            .push(b"\x1b]1", TerminalBackgroundTheme::Dark)
            .is_empty());
        assert!(scanner
            .push(b"1;?", TerminalBackgroundTheme::Dark)
            .is_empty());
        let replies = scanner.push(b"\x07", TerminalBackgroundTheme::Dark);
        assert_eq!(replies, format_osc_color_reply(11, (0x1f, 0x20, 0x22)));
    }

    #[test]
    fn ignores_non_query_osc_color_set() {
        let mut scanner = OscColorQueryScanner::new();
        // OSC 11 设色（非 ?）不应被当成查询应答。
        let replies = scanner.push(
            b"\x1b]11;rgb:1111/2222/3333\x07hello",
            TerminalBackgroundTheme::Dark,
        );
        assert!(replies.is_empty());
    }

    #[test]
    fn dark_background_is_lifted_above_near_black() {
        // 反馈环：近纯黑 (#050506) 下 Codex 只会抬升到 ~#232323，composer 与背景
        // 对比度约 1.3:1，肉眼等同「全黑」。dark OSC 背景不得再贴纯黑。
        let bg = TerminalBackgroundTheme::Dark.osc_colors().background;
        assert!(
            bg.0 >= 0x18 && bg.1 >= 0x18 && bg.2 >= 0x18,
            "dark OSC background {:?} too close to pure black; Codex composer washout",
            bg
        );
    }
}
