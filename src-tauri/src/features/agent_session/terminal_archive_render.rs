//! 将 TUI runtime 原始字节流重放为可读纯文本（ADR-0023 / ADR-0025 写侧辅助）。
//!
//! Grok 等全屏 TUI 用 cursor addressing 重绘，简单剥 CSI 会得到无换行粘连噪声。
//! 本模块用轻量屏缓冲回放，在清屏 / 回原点时采样帧，合并去重后输出。

const DEFAULT_ROWS: usize = 48;
const DEFAULT_COLS: usize = 200;
const MAX_FRAMES: usize = 64;

/// 把终端原始输出重放为按行纯文本（已去掉控制序列语义）。
pub(crate) fn render_terminal_snapshot_text(raw: &str) -> String {
    let mut screen = Screen::new(DEFAULT_ROWS, DEFAULT_COLS);
    let mut frames: Vec<String> = Vec::new();
    let chars: Vec<char> = raw.chars().collect();
    let mut index = 0usize;

    while index < chars.len() {
        let character = chars[index];
        if character == '\u{1b}' {
            index = apply_escape(&mut screen, &chars, index, &mut frames);
            continue;
        }
        screen.put(character);
        index += 1;
    }

    push_frame(&mut frames, &screen);
    let joined = join_frames(&frames);
    collapse_cjk_cell_padding(&joined)
}

struct Screen {
    rows: usize,
    cols: usize,
    row: usize,
    col: usize,
    cells: Vec<Vec<char>>,
    dirty: bool,
}

impl Screen {
    fn new(rows: usize, cols: usize) -> Self {
        Self {
            rows,
            cols,
            row: 0,
            col: 0,
            cells: vec![vec![' '; cols]; rows],
            dirty: false,
        }
    }

    fn put(&mut self, character: char) {
        match character {
            '\n' => {
                self.row = (self.row + 1).min(self.rows.saturating_sub(1));
                self.col = 0;
                self.dirty = true;
            }
            '\r' => {
                self.col = 0;
            }
            '\t' => {
                let next = ((self.col / 8) + 1) * 8;
                self.col = next.min(self.cols.saturating_sub(1));
                self.dirty = true;
            }
            '\u{08}' => {
                self.col = self.col.saturating_sub(1);
            }
            c if c.is_control() => {}
            c => {
                if self.row < self.rows && self.col < self.cols {
                    self.cells[self.row][self.col] = c;
                    self.col += 1;
                    if self.col >= self.cols {
                        self.col = 0;
                        self.row = (self.row + 1).min(self.rows.saturating_sub(1));
                    }
                    self.dirty = true;
                }
            }
        }
    }

    fn cup(&mut self, row: usize, col: usize) {
        self.row = row.saturating_sub(1).min(self.rows.saturating_sub(1));
        self.col = col.saturating_sub(1).min(self.cols.saturating_sub(1));
    }

    fn erase_display(&mut self, mode: usize) {
        match mode {
            2 | 3 => {
                for row in &mut self.cells {
                    row.fill(' ');
                }
                self.row = 0;
                self.col = 0;
                self.dirty = true;
            }
            0 => {
                for col in self.col..self.cols {
                    self.cells[self.row][col] = ' ';
                }
                for row in (self.row + 1)..self.rows {
                    self.cells[row].fill(' ');
                }
                self.dirty = true;
            }
            1 => {
                for row in 0..self.row {
                    self.cells[row].fill(' ');
                }
                for col in 0..=self.col.min(self.cols.saturating_sub(1)) {
                    self.cells[self.row][col] = ' ';
                }
                self.dirty = true;
            }
            _ => {}
        }
    }

    fn erase_line(&mut self, mode: usize) {
        match mode {
            2 => {
                self.cells[self.row].fill(' ');
                self.dirty = true;
            }
            0 => {
                for col in self.col..self.cols {
                    self.cells[self.row][col] = ' ';
                }
                self.dirty = true;
            }
            1 => {
                for col in 0..=self.col.min(self.cols.saturating_sub(1)) {
                    self.cells[self.row][col] = ' ';
                }
                self.dirty = true;
            }
            _ => {}
        }
    }

    fn text(&self) -> String {
        let mut lines: Vec<String> = self
            .cells
            .iter()
            .map(|row| row.iter().collect::<String>().trim_end().to_string())
            .collect();
        while lines.first().is_some_and(|line| line.trim().is_empty()) {
            lines.remove(0);
        }
        while lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.pop();
        }
        lines.join("\n")
    }
}

fn apply_escape(
    screen: &mut Screen,
    chars: &[char],
    esc_index: usize,
    frames: &mut Vec<String>,
) -> usize {
    let next_index = esc_index + 1;
    if next_index >= chars.len() {
        return chars.len();
    }

    match chars[next_index] {
        '[' => {
            let mut cursor = next_index + 1;
            while cursor < chars.len() {
                let ch = chars[cursor];
                if ('@'..='~').contains(&ch) {
                    let params: String = chars[next_index + 1..cursor].iter().collect();
                    handle_csi(screen, &params, ch, frames);
                    return cursor + 1;
                }
                cursor += 1;
            }
            chars.len()
        }
        ']' => {
            let mut cursor = next_index + 1;
            while cursor < chars.len() {
                if chars[cursor] == '\u{7}' {
                    return cursor + 1;
                }
                if chars[cursor] == '\u{1b}'
                    && cursor + 1 < chars.len()
                    && chars[cursor + 1] == '\\'
                {
                    return cursor + 2;
                }
                cursor += 1;
            }
            chars.len()
        }
        _ => next_index + 1,
    }
}

fn handle_csi(screen: &mut Screen, params: &str, final_byte: char, frames: &mut Vec<String>) {
    let private = params.starts_with('?');
    let body = params.trim_start_matches('?');
    let nums: Vec<usize> = body
        .split(';')
        .filter_map(|part| {
            if part.is_empty() {
                None
            } else {
                part.parse::<usize>().ok()
            }
        })
        .collect();

    match final_byte {
        'H' | 'f' => {
            let row = nums.first().copied().unwrap_or(1).max(1);
            let col = nums.get(1).copied().unwrap_or(1).max(1);
            if row == 1 && col == 1 && screen.dirty {
                push_frame(frames, screen);
            }
            screen.cup(row, col);
        }
        'J' => {
            let mode = nums.first().copied().unwrap_or(0);
            if mode >= 2 && screen.dirty {
                push_frame(frames, screen);
            }
            screen.erase_display(mode);
        }
        'K' => {
            screen.erase_line(nums.first().copied().unwrap_or(0));
        }
        'A' => {
            let n = nums.first().copied().unwrap_or(1).max(1);
            screen.row = screen.row.saturating_sub(n);
        }
        'B' => {
            let n = nums.first().copied().unwrap_or(1).max(1);
            screen.row = (screen.row + n).min(screen.rows.saturating_sub(1));
        }
        'C' => {
            let n = nums.first().copied().unwrap_or(1).max(1);
            screen.col = (screen.col + n).min(screen.cols.saturating_sub(1));
        }
        'D' => {
            let n = nums.first().copied().unwrap_or(1).max(1);
            screen.col = screen.col.saturating_sub(n);
        }
        'h' | 'l' if private => {}
        'm' | 'r' | 'n' | 't' | 'c' | 's' | 'u' => {}
        _ => {}
    }
}

fn push_frame(frames: &mut Vec<String>, screen: &Screen) {
    let text = screen.text();
    if text.trim().is_empty() {
        return;
    }
    if frames.last().is_some_and(|prev| prev == &text) {
        return;
    }
    frames.push(text);
    if frames.len() > MAX_FRAMES {
        let overflow = frames.len() - MAX_FRAMES;
        frames.drain(0..overflow);
    }
}

fn join_frames(frames: &[String]) -> String {
    if frames.is_empty() {
        return String::new();
    }
    let start = frames.len().saturating_sub(12);
    frames[start..].join("\n\n")
}

fn collapse_cjk_cell_padding(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut index = 0usize;
    while index < chars.len() {
        let current = chars[index];
        if is_cjk(current)
            && index + 2 < chars.len()
            && chars[index + 1] == ' '
            && is_cjk(chars[index + 2])
        {
            out.push(current);
            index += 2;
            continue;
        }
        out.push(current);
        index += 1;
    }
    out
}

fn is_cjk(c: char) -> bool {
    matches!(
        c,
        '\u{4e00}'..='\u{9fff}'
            | '\u{3400}'..='\u{4dbf}'
            | '\u{f900}'..='\u{faff}'
            | '\u{3000}'..='\u{303f}'
            | '\u{ff00}'..='\u{ffef}'
    )
}

#[cfg(test)]
mod tests {
    use super::{collapse_cjk_cell_padding, render_terminal_snapshot_text};

    #[test]
    fn render_cup_and_text_produces_newlines() {
        let raw = "\u{1b}[1;1Hhello\u{1b}[2;1Hworld";
        let got = render_terminal_snapshot_text(raw);
        assert!(got.contains("hello"), "got={got:?}");
        assert!(got.contains("world"), "got={got:?}");
        assert!(got.contains('\n'), "expected newline layout: {got:?}");
    }

    #[test]
    fn collapse_cjk_padding_joins_spaced_han() {
        let got = collapse_cjk_cell_padding("下 一 决 策");
        assert_eq!(got, "下一决策");
    }

    #[test]
    fn osc_title_is_not_leaked_as_text() {
        let raw = "\u{1b}]0;grok title\u{7}\u{1b}[1;1Hvisible";
        let got = render_terminal_snapshot_text(raw);
        assert!(got.contains("visible"), "got={got:?}");
        assert!(!got.contains("grok title"), "got={got:?}");
        assert!(!got.contains("]0;"), "got={got:?}");
    }
}
