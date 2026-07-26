use super::{extract_tui_archive_conclusion_text, latest_output_from_archive_text};

#[test]
fn keeps_user_and_final_conclusion_drops_process_and_chrome() {
    let input = "\
banner residual

• Working(on it...)
• Ran ls -la
  │ total 1
  └ file.txt
    … +4 lines (ctrl + t to view transcript)

› 请总结目录内容

• Ran cat README
  └ hello

• 目录里只有 README，内容为 hello。

";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 请总结目录内容

• 目录里只有 README，内容为 hello。";
    assert_eq!(got, expected);
    assert_eq!(
        latest_output_from_archive_text(&got).as_deref(),
        Some("• 目录里只有 README，内容为 hello。")
    );
}

#[test]
fn multi_turn_keeps_only_last_conclusion_per_turn() {
    let input = "\
› 第一问

• 中间想法，应被丢弃
• Ran tool
  └ out
• 第一问结论

› 第二问

• Ran other
• 第二问结论
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 第一问

• 第一问结论

› 第二问

• 第二问结论";
    assert_eq!(got, expected);
}

#[test]
fn status_header_is_not_user_input_real_chinese_user_is() {
    let input = "\
› Find and fix a bug in @filename grok-4.5 high · ~/workspace/kafka/redwhisk

• 这段在真用户前，应丢弃

• Ran noise
  └ x

› 使用 skill 排查卡顿问题

• 结论：首屏同步加载过重
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 使用 skill 排查卡顿问题

• 结论：首屏同步加载过重";
    assert_eq!(got, expected);
    assert!(
        !got.contains("Find and fix a bug"),
        "状态头不应保留: {got:?}"
    );
}

#[test]
fn turn_without_conclusion_keeps_only_user_block() {
    let input = "\
› 只提问没有回答

• Ran something
  └ noise
";
    let got = extract_tui_archive_conclusion_text(input);
    assert_eq!(got, "› 只提问没有回答");
}

#[test]
fn multiline_user_block_preserved_with_spacing_contract() {
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

  第二行继续说明。

  第三行附件说明。

• 最终答复一行";
    assert_eq!(got, expected);
    assert!(!got.contains("\n\n\n"), "块内连续空行最多 1: {got:?}");
}

#[test]
fn drops_inline_working_sticky_chrome_and_fold_lines() {
    let input = "\
pre•Working(17s • esc to interrupt) › Find and fix · ~/path

› 真实问题

• Ran echo hi
    … +12 lines (ctrl + t to view transcript)

• 干净结论
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 真实问题

• 干净结论";
    assert_eq!(got, expected);
    assert!(!got.contains("Working("));
    assert!(!got.contains("ctrl + t"));
    assert!(!got.contains("… +"));
}

#[test]
fn normalizes_cr_and_trailing_blank_collapse() {
    let input = "› 问\r\n\r\n• Ran x\r\n• 答\r\n\r\n\r\n";
    let got = extract_tui_archive_conclusion_text(input);
    assert_eq!(got, "› 问\n\n• 答");
}


#[test]
fn decorative_lines_inside_conclusion_do_not_truncate() {
    let input = "\
› 问性能

• Ran measure
  └ ok

• ## 结论

  首屏同步加载过重。

  ────────────────────────────────────────────────

  主包从 5.8MB 降到 1.1MB。
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 问性能

• ## 结论

  首屏同步加载过重。

  主包从 5.8MB 降到 1.1MB。";
    assert_eq!(got, expected);
}

#[test]
fn ascii_gt_shell_echo_is_not_user_turn() {
    let input = "\
› 真用户

• 中间进度

• Ran pnpm
  └ ok
    > tsc --noEmit

• ## 结论

  完成。
";
    let got = extract_tui_archive_conclusion_text(input);
    let expected = "\
› 真用户

• ## 结论

  完成。";
    assert_eq!(got, expected);
    assert!(!got.contains("> tsc"), "shell 回显不应成为用户块: {got:?}");
    assert!(!got.contains("中间进度"), "工具前的中间发言不应保留: {got:?}");
}


#[test]
fn without_user_prompt_falls_back_to_light_clean_not_empty() {
    let input = "\
$ ls
file.txt

• Working(on it...)

Done with archive.
";
    let got = extract_tui_archive_conclusion_text(input);
    assert!(!got.trim().is_empty(), "fallback must not empty archive: {got:?}");
    assert!(got.contains("$ ls"), "fallback keeps shell output: {got:?}");
    assert!(got.contains("Done with archive."), "fallback keeps final text: {got:?}");
    assert!(!got.contains("Working("), "fallback drops Working status: {got:?}");
    assert_eq!(
        latest_output_from_archive_text(&got).as_deref(),
        Some("Done with archive.")
    );
}

#[test]
fn status_header_only_session_falls_back_instead_of_empty() {
    let input = "\
› Find and fix a bug in @filename grok-4.5 high · ~/workspace/kafka/redwhisk

• Ran noise
  └ x

• 自动阶段完成，请验收
";
    let got = extract_tui_archive_conclusion_text(input);
    assert!(
        !got.trim().is_empty(),
        "status-header-only session must not archive empty: {got:?}"
    );
    assert!(
        got.contains("自动阶段完成，请验收"),
        "fallback should keep final speech: {got:?}"
    );
}
