use agentgrep::cli::GrepArgs;
use agentgrep::search::run_grep;
use std::fs;
use std::path::Path;

fn main() {
    let temp = tempfile::tempdir().expect("tempdir");
    let src_dir = temp.path().join("src");
    fs::create_dir_all(&src_dir).expect("mkdir");
    fs::write(
        src_dir.join("app.rs"),
        "pub fn auth_status() {}\nfn render_status_bar() {}\n",
    )
    .expect("write file");

    let args = GrepArgs {
        query: "auth_status".to_string(),
        regex: false,
        file_type: Some("rs".to_string()),
        json: false,
        paths_only: false,
        hidden: false,
        no_ignore: false,
        path: None,
        glob: None,
    };

    println!("Running grep on: {:?}", temp.path());
    match run_grep(temp.path(), &args) {
        Ok(result) => {
            println!("Success!");
            println!("Total files: {}", result.total_files);
            println!("Total matches: {}", result.total_matches);
            for file in result.files {
                println!("  File: {}", file.path);
                for m in file.matches {
                    println!("    Line {}: {}", m.line_number, m.line);
                }
            }
        }
        Err(err) => {
            println!("Error: {}", err);
        }
    }
}
