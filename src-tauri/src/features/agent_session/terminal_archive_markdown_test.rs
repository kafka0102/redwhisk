use super::markdown_labels_to_plain_text;

#[test]
fn markdown_labels_to_plain_text_strips_common_markers() {
    let input = "\
• <issue-comment>

  **故障仓储映射** 已落地

  - 做了什么：拆分 mappers

    </issue-comment>

## 结果

已按 workflow 完成。

## 关键改动

- `mapper-shared.ts`（27）
- [设计](https://example.com/design)

```
code fence body
```
";
    let got = markdown_labels_to_plain_text(input);
    assert!(
        !got.contains("<issue-comment>"),
        "open tag must be stripped: {got:?}"
    );
    assert!(
        !got.contains("</issue-comment>"),
        "close tag must be stripped: {got:?}"
    );
    assert!(!got.contains("## 结果"), "heading marks must go: {got:?}");
    assert!(got.contains("结果"), "heading text kept: {got:?}");
    assert!(!got.contains("**故障仓储映射**"), "bold marks must go: {got:?}");
    assert!(got.contains("故障仓储映射"), "bold text kept: {got:?}");
    assert!(!got.contains("`mapper-shared.ts`"), "inline code ticks go: {got:?}");
    assert!(got.contains("mapper-shared.ts"), "inline code text kept: {got:?}");
    assert!(!got.contains("[设计](https://example.com/design)"), "link syntax goes: {got:?}");
    assert!(got.contains("设计"), "link label kept: {got:?}");
    assert!(!got.contains("```"), "fence markers go: {got:?}");
    assert!(got.contains("code fence body"), "fence body kept: {got:?}");
}

#[test]
fn real_archive_fixture_markdown_labels_become_plain() {
    let input = "\
• <issue-comment>

  **故障仓储映射 read/write/normalize 内部簇已落地（架构评审 #3）**

  - 做了什么：mappers.ts 拆簇

    </issue-comment>

  ## 结果

  已按 workflow 完成重构。

  ## 关键改动

  - mapper-shared.ts
";
    let got = markdown_labels_to_plain_text(input);
    assert!(!got.contains("<issue-comment>"), "got={got:?}");
    assert!(!got.contains("</issue-comment>"), "got={got:?}");
    assert!(!got.contains("## 结果"), "got={got:?}");
    assert!(!got.contains("## 关键改动"), "got={got:?}");
    assert!(!got.contains("**故障仓储映射"), "got={got:?}");
    assert!(got.contains("故障仓储映射"), "got={got:?}");
    assert!(got.contains("结果"), "got={got:?}");
    assert!(got.contains("关键改动"), "got={got:?}");
    assert!(got.contains("mapper-shared.ts"), "got={got:?}");
}
