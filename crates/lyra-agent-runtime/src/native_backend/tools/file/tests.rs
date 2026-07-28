use super::*;

#[test]
fn fuzzy_falls_back_to_exact_when_present() {
    let original = "let a = 1;\nlet b = 2;\n";
    let updated =
        apply_fuzzy_replacement(original, "let b = 2;", "let b = 3;", false).expect("exact hit");
    assert_eq!(updated, "let a = 1;\nlet b = 3;\n");
}

#[test]
fn fuzzy_tolerates_indentation_mismatch_verbatim_insert() {
    // File indents the block with 4 spaces; model's oldString has 6 (exact
    // match fails because 6-space prefix isn't a substring of 4-space line).
    // Model's newString has the correct 4-space indent — inserted verbatim.
    let original = "fn main() {\n    let x = 1;\n}\n";
    let updated = apply_fuzzy_replacement(original, "      let x = 1;", "    let x = 42;", false)
        .expect("whitespace-insensitive hit");
    // newString is inserted verbatim — no reindent, no corruption.
    assert_eq!(updated, "fn main() {\n    let x = 42;\n}\n");
}

#[test]
fn fuzzy_multiline_block_verbatim_insert() {
    let original = "class C:\n    def f(self):\n        return 1\n";
    // Model's oldString has more indent than the file (6/10 vs 4/8) — exact
    // match fails; fuzzy locates by trimmed content; newString (correct 4/8
    // indent) is inserted verbatim.
    let old = "      def f(self):\n          return 1";
    let new = "    def f(self):\n        return 2";
    let updated = apply_fuzzy_replacement(original, old, new, false).expect("block hit");
    assert_eq!(updated, "class C:\n    def f(self):\n        return 2\n");
}

#[test]
fn fuzzy_rejects_multiple_whitespace_matches_without_replace_all() {
    let original = "    log()\n    log()\n";
    let failure = apply_fuzzy_replacement(original, "log()", "trace()", false)
        .expect_err("ambiguous fuzzy match must fail, never pick the first");
    assert_eq!(failure.code, "edit_not_unique");
}

#[test]
fn fuzzy_reports_not_found_when_absent() {
    let failure =
        apply_fuzzy_replacement("alpha\n", "beta", "gamma", false).expect_err("missing target");
    assert_eq!(failure.code, "edit_not_found");
}

#[test]
fn codex_add_file_accepts_bare_and_plus_prefixed_lines() {
    // Standard Codex form (bare add-file lines) — used to fail before B3.
    let bare = "*** Begin Patch\n*** Add File: a.txt\nhello\nworld\n*** End Patch";
    let ops = parse_codex_patch(bare).expect("bare add-file lines accepted");
    match &ops[0] {
        CodexPatchOperation::Add { path, content } => {
            assert_eq!(path, "a.txt");
            assert_eq!(content, "hello\nworld\n");
        }
        other => panic!("expected Add, got {other:?}"),
    }

    // Lyra-extended form ('+'-prefixed) must keep working too.
    let plus = "*** Begin Patch\n*** Add File: b.txt\n+hello\n+world\n*** End Patch";
    let ops = parse_codex_patch(plus).expect("plus-prefixed add-file lines accepted");
    match &ops[0] {
        CodexPatchOperation::Add { path, content } => {
            assert_eq!(path, "b.txt");
            assert_eq!(content, "hello\nworld\n");
        }
        other => panic!("expected Add, got {other:?}"),
    }
}
