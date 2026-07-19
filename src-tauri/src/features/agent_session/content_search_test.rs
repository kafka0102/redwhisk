use super::*;
use std::fs;
use std::io::Write;
use tempfile::tempdir;

fn sample_input(query: &str) -> WorkspaceContentSearchInput {
        WorkspaceContentSearchInput {
            project_id: 1,
            session_id: None,
            workspace_path: None,
            query: query.to_string(),
            match_case: false,
            match_whole_word: false,
            use_regex: false,
            include: Vec::new(),
            exclude: Vec::new(),
        }
    }

    fn write_file(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(&path, content).expect("write");
    }

    #[test]
    fn empty_query_returns_empty_without_scanning() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "a.ts", "hello world");
        let result = search_workspace_content(dir.path(), &sample_input("   ")).expect("search");
        assert_eq!(result.file_count, 0);
        assert_eq!(result.match_count, 0);
        assert!(!result.truncated);
        assert!(result.files.is_empty());
    }

    #[test]
    fn finds_literal_matches_grouped_by_file() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "src/a.ts", "const foo = 1;\nconst bar = 2;\nfoo again\n");
        write_file(dir.path(), "src/b.ts", "nope\n");
        write_file(dir.path(), "readme.md", "foo in docs\n");

        let result = search_workspace_content(dir.path(), &sample_input("foo")).expect("search");
        assert_eq!(result.file_count, 2);
        assert_eq!(result.match_count, 3);
        assert!(!result.truncated);

        let paths: Vec<_> = result.files.iter().map(|f| f.file_path.as_str()).collect();
        assert_eq!(paths, vec!["readme.md", "src/a.ts"]);

        let a = result
            .files
            .iter()
            .find(|f| f.file_path == "src/a.ts")
            .expect("a.ts group");
        assert_eq!(a.file_name, "a.ts");
        assert_eq!(a.match_count, 2);
        assert_eq!(a.matches[0].line_number, 1);
        assert_eq!(a.matches[0].line_text, "const foo = 1;");
        assert_eq!(a.matches[1].line_number, 3);
    }

    #[test]
    fn skips_hidden_dirs_binary_and_large_files() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "keep.ts", "needle here\n");
        write_file(dir.path(), "node_modules/lib.js", "needle hidden\n");
        write_file(dir.path(), "target/out.rs", "needle hidden\n");

        let binary_path = dir.path().join("blob.bin");
        fs::write(&binary_path, b"nee\0dle").expect("binary");

        let large_path = dir.path().join("huge.txt");
        let mut large = fs::File::create(&large_path).expect("create large");
        let chunk = b"needle\n";
        let mut written = 0u64;
        while written <= MAX_TEXT_FILE_BYTES {
            large.write_all(chunk).expect("write chunk");
            written += chunk.len() as u64;
        }

        let result = search_workspace_content(dir.path(), &sample_input("needle")).expect("search");
        assert_eq!(result.file_count, 1);
        assert_eq!(result.files[0].file_path, "keep.ts");
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn match_case_and_whole_word_and_regex() {
        let dir = tempdir().expect("tempdir");
        write_file(
            dir.path(),
            "words.ts",
            "Foo food FOO\nword\nre_match_123\n",
        );

        let mut case_sensitive = sample_input("Foo");
        case_sensitive.match_case = true;
        let case_result =
            search_workspace_content(dir.path(), &case_sensitive).expect("case search");
        assert_eq!(case_result.match_count, 1);
        assert!(case_result.files[0].matches[0].line_text.contains("Foo food"));

        let mut whole = sample_input("Foo");
        whole.match_case = true;
        whole.match_whole_word = true;
        let whole_result = search_workspace_content(dir.path(), &whole).expect("whole word");
        // "Foo" as whole word on line 1 — "Foo" matches, "food" does not, "FOO" fails case
        assert_eq!(whole_result.match_count, 1);

        let mut regex_input = sample_input(r"re_match_\d+");
        regex_input.use_regex = true;
        let regex_result = search_workspace_content(dir.path(), &regex_input).expect("regex");
        assert_eq!(regex_result.match_count, 1);
        assert_eq!(regex_result.files[0].matches[0].line_number, 3);
    }

    #[test]
    fn invalid_regex_returns_command_error() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "a.ts", "x");
        let mut input = sample_input("(");
        input.use_regex = true;
        let error = search_workspace_content(dir.path(), &input).expect_err("invalid regex");
        assert_eq!(error.reason.as_deref(), Some("invalidSearchRegex"));
    }

    #[test]
    fn respects_include_and_exclude_filters() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "src/a.ts", "hit\n");
        write_file(dir.path(), "src/b.js", "hit\n");
        write_file(dir.path(), "docs/a.md", "hit\n");

        let mut input = sample_input("hit");
        input.include = vec!["**/*.ts".to_string(), "**/*.md".to_string()];
        input.exclude = vec!["docs/**".to_string()];
        let result = search_workspace_content(dir.path(), &input).expect("filtered");
        assert_eq!(result.file_count, 1);
        assert_eq!(result.files[0].file_path, "src/a.ts");
    }

    #[test]
    fn truncates_when_limits_hit() {
        let dir = tempdir().expect("tempdir");
        // 超过每文件 50 条：一个文件 60 行匹配
        let many_lines = (0..60)
            .map(|i| format!("match line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        write_file(dir.path(), "many.ts", &many_lines);

        let result = search_workspace_content(dir.path(), &sample_input("match")).expect("search");
        assert!(result.truncated);
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].matches.len(), MAX_MATCHES_PER_FILE);
        assert_eq!(result.match_count as usize, MAX_MATCHES_PER_FILE);
    }

    #[test]
    fn empty_include_and_exclude_means_all_eligible() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "src/a.ts", "hit\n");
        write_file(dir.path(), "docs/a.md", "hit\n");

        let result = search_workspace_content(dir.path(), &sample_input("hit")).expect("all");
        assert_eq!(result.file_count, 2);
    }

    #[test]
    fn exclude_wins_over_include_when_both_match() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "src/keep.ts", "hit\n");
        write_file(dir.path(), "src/drop.test.ts", "hit\n");

        let mut input = sample_input("hit");
        input.include = vec!["**/*.ts".to_string()];
        input.exclude = vec!["**/*.test.ts".to_string()];
        let result = search_workspace_content(dir.path(), &input).expect("filtered");
        assert_eq!(result.file_count, 1);
        assert_eq!(result.files[0].file_path, "src/keep.ts");
    }

    #[test]
    fn multiple_include_tags_are_or() {
        let dir = tempdir().expect("tempdir");
        write_file(dir.path(), "a.ts", "hit\n");
        write_file(dir.path(), "b.rs", "hit\n");
        write_file(dir.path(), "c.md", "hit\n");

        let mut input = sample_input("hit");
        input.include = vec!["**/*.ts".to_string(), "**/*.rs".to_string()];
        let result = search_workspace_content(dir.path(), &input).expect("or include");
        let mut paths: Vec<_> = result.files.iter().map(|f| f.file_path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.ts", "b.rs"]);
    }
