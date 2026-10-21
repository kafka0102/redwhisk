use super::extract_tui_archive_conclusion_text;

/// 新归档：跨空行的用户输入仍是一个用户块，空行写成单独一行 `›`；
/// 结论保留 `#` 与段落空行，且不以 `›` 开头。工具过程与 chrome 不入档。
#[test]
fn extract_marks_user_lines_and_keeps_conclusion_markdown_blanks() {
    let input = "\
banner residual
• Working(on it...)

› 第一行

  中间空行后的第二行

• Ran ls -la
  └ file.txt
    … +4 lines (ctrl + t to view transcript)

• # 结论

  第一段。


  第二段。
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 第一行
›
› 中间空行后的第二行

• # 结论

  第一段。


  第二段。";
    assert_eq!(got, expected);
    assert!(!got.contains("Working("), "{got:?}");
    assert!(!got.contains("Ran ls"), "{got:?}");
    assert!(!got.contains("ctrl + t"), "{got:?}");
}

#[test]
fn multiline_user_block_marks_every_line_including_blank() {
    let input = "\
› 第一行用户输入：

  第二行继续说明。

  第三行附件说明。

• Ran ls
  └ x

• 最终答复一行
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 第一行用户输入：
›
› 第二行继续说明。
›
› 第三行附件说明。

• 最终答复一行";
    assert_eq!(got, expected);
}
