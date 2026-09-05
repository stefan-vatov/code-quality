use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

struct Project(PathBuf);

impl Project {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "thx-comments-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join("src")).unwrap();
        fs::write(
            path.join("Cargo.toml"),
            "[package]\nname = \"consumer\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .unwrap();
        fs::write(path.join("src/lib.rs"), "").unwrap();
        Self(path)
    }

    fn write(&self, path: &str, source: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, source).unwrap();
    }

    fn check(&self) -> Output {
        check(&self.0)
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn check(path: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_cargo-thx-lint"))
        .args(["thx-lint", "check", "--cwd"])
        .arg(path)
        .output()
        .unwrap()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn rejects_every_comment_form_with_locations() {
    let project = Project::new();
    for comment in [
        "// ordinary",
        "/// doc",
        "//! inner",
        "/** doc */",
        "/*! inner */",
        "/* outer /* nested */ end */",
        "/**/",
        "/* unterminated",
    ] {
        project.write("src/lib.rs", &format!("\n  {comment}\n"));
        let output = project.check();
        assert!(!output.status.success(), "accepted {comment}");
        assert!(
            stderr(&output).contains("src/lib.rs:2:3: error[no-comments]"),
            "{}",
            stderr(&output)
        );
    }
}

#[test]
fn accepts_literals_lifetimes_and_interpreter_directive() {
    let project = Project::new();
    project.write(
        "src/lib.rs",
        r####"#!/usr/bin/env rust-script // interpreter argument
const TEXT: &str = "// /* escaped \" */";
const RAW: &str = r###"// /* " ##"###;
const BYTE: &[u8] = b"// /*";
const RAW_BYTE: &[u8] = br#"/* //"#;
const C: &core::ffi::CStr = c"escaped \" // /*";
const RAW_C: &core::ffi::CStr = cr##"" // /*"##;
const CHAR: char = '/';
fn borrow<'a>(x: &'a str) -> &'a str { x }
"####,
    );
    let output = project.check();
    assert!(output.status.success(), "{}", stderr(&output));
}

#[test]
fn scans_disabled_code_configs_and_reports_multiple_files() {
    let project = Project::new();
    project.write(
        "src/lib.rs",
        "#[cfg(any())]\nmod disabled { /* banned */ }\n",
    );
    project.write("configs/checks/depth/src/lib.rs", "// embedded source\n");
    let output = project.check();
    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("src/lib.rs:2:16: error[no-comments]"),
        "{}",
        stderr(&output)
    );
    assert!(
        stderr(&output).contains("configs/checks/depth/src/lib.rs:1:1: error[no-comments]"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn ignores_dependency_and_output_directories() {
    let project = Project::new();
    for directory in [".git", "target", "deps", "vendor", ".thethracian-checks"] {
        project.write(&format!("{directory}/nested/bad.rs"), "// ignored\n");
    }
    let output = project.check();
    assert!(output.status.success(), "{}", stderr(&output));
}

#[test]
fn scans_workspace_members_from_member_cwd() {
    let project = Project::new();
    project.write(
        "Cargo.toml",
        "[workspace]\nmembers = [\"members/*\"]\nresolver = \"3\"\n",
    );
    for member in ["a", "b"] {
        project.write(
            &format!("members/{member}/Cargo.toml"),
            &format!("[package]\nname = \"{member}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"),
        );
        project.write(&format!("members/{member}/src/lib.rs"), "");
    }
    project.write("members/b/src/lib.rs", "// sibling member\n");
    let output = check(&project.0.join("members/a/src"));
    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("members/b/src/lib.rs:1:1: error[no-comments]"),
        "{}",
        stderr(&output)
    );
}

#[cfg(unix)]
#[test]
fn rejects_directory_symlinks_including_loops() {
    let project = Project::new();
    std::os::unix::fs::symlink(&project.0, project.0.join("src/loop")).unwrap();
    let output = project.check();
    assert!(
        !output.status.success(),
        "source directory symlink was silently skipped"
    );
    assert!(
        stderr(&output).contains("src/loop: error[no-comments]: source symlinks are unsupported"),
        "{}",
        stderr(&output)
    );
}

#[cfg(unix)]
#[test]
fn rejects_source_symlinks_even_when_broken_or_comment_free() {
    let project = Project::new();
    let external = Project::new();
    let link = project.0.join("src/linked.rs");
    for contents in ["// outside selected tree\n", "pub fn clean() {}\n"] {
        external.write("src/lib.rs", contents);
        std::os::unix::fs::symlink(external.0.join("src/lib.rs"), &link).unwrap();
        let output = project.check();
        assert!(
            !output.status.success(),
            "source symlink was silently skipped"
        );
        assert!(
            stderr(&output)
                .contains("src/linked.rs: error[no-comments]: source symlinks are unsupported"),
            "{}",
            stderr(&output)
        );
        fs::remove_file(&link).unwrap();
    }
    std::os::unix::fs::symlink(external.0.join("missing.rs"), &link).unwrap();
    let output = project.check();
    assert!(
        !output.status.success(),
        "broken source symlink was silently skipped"
    );
    assert!(
        stderr(&output)
            .contains("src/linked.rs: error[no-comments]: source symlinks are unsupported"),
        "{}",
        stderr(&output)
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_directories_containing_external_sources() {
    let project = Project::new();
    let external = Project::new();
    external.write("src/lib.rs", "// outside selected tree\n");
    std::os::unix::fs::symlink(external.0.join("src"), project.0.join("src/linked")).unwrap();
    let output = project.check();
    assert!(
        !output.status.success(),
        "source directory symlink was silently skipped"
    );
    assert!(
        stderr(&output).contains("src/linked: error[no-comments]: source symlinks are unsupported"),
        "{}",
        stderr(&output)
    );
}

#[cfg(unix)]
#[test]
fn ignores_excluded_directory_links_and_regular_non_source_links() {
    let project = Project::new();
    let external = Project::new();
    external.write("src/lib.rs", "// dependency source\n");
    external.write("README.md", "Dependency documentation\n");
    for name in [
        ".git",
        "target",
        "deps",
        "vendor",
        ".thethracian-checks",
        "build-output",
    ] {
        std::os::unix::fs::symlink(&external.0, project.0.join(name)).unwrap();
    }
    std::os::unix::fs::symlink(external.0.join("README.md"), project.0.join("README.md")).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_cargo-thx-lint"))
        .args(["check", "--cwd"])
        .arg(&project.0)
        .env("CARGO_TARGET_DIR", project.0.join("build-output"))
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", stderr(&output));
}

#[test]
fn comment_dense_sources_finish_with_exact_unicode_and_multiline_locations() {
    let project = Project::new();
    let prefix = "#![allow(dead_code)]\nconst X: &str = r#\"é\n/* literal */\"#;\n";
    project.write(
        "src/lib.rs",
        &format!("{prefix}{}", "/*é\r\n*/ /*x*/\r\n".repeat(50_000)),
    );
    let diagnostics = project.0.join("diagnostics.txt");
    let mut child = Command::new(env!("CARGO_BIN_EXE_cargo-thx-lint"))
        .args(["check", "--cwd"])
        .arg(&project.0)
        .stdout(Stdio::null())
        .stderr(fs::File::create(&diagnostics).unwrap())
        .spawn()
        .unwrap();
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if start.elapsed() > Duration::from_secs(10) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!(
                "100,000 comments exceeded 10 seconds; position tracking must not rescan source prefixes"
            );
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(!status.success());
    let output = fs::read_to_string(diagnostics).unwrap();
    assert_eq!(output.matches("error[no-comments]").count(), 100_000);
    for location in ["src/lib.rs:4:1:", "src/lib.rs:5:4:", "src/lib.rs:100003:4:"] {
        assert!(output.contains(location), "missing location {location}");
    }
    assert!(output.ends_with("100000 forbidden comment(s) found\n"));
}

#[test]
fn missing_project_and_invalid_source_fail_closed() {
    let project = Project::new();
    let missing = check(&project.0.join("missing"));
    assert!(!missing.status.success());
    assert!(
        !stderr(&missing).contains("Unknown command"),
        "{}",
        stderr(&missing)
    );
    fs::write(project.0.join("src/lib.rs"), [0xff]).unwrap();
    let output = project.check();
    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("src/lib.rs"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn respects_custom_cargo_target_directory() {
    let project = Project::new();
    project.write("build-output/generated.rs", "// generated\n");
    let output = Command::new(env!("CARGO_BIN_EXE_cargo-thx-lint"))
        .args(["check", "--cwd"])
        .arg(&project.0)
        .env("CARGO_TARGET_DIR", project.0.join("build-output"))
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", stderr(&output));
}

#[test]
fn handles_bom_crlf_and_unicode_columns() {
    let project = Project::new();
    project.write(
        "src/lib.rs",
        "\u{feff}#!/usr/bin/env rust-script\r\nconst X: &str = \"é\"; // banned\r\n",
    );
    let output = project.check();
    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("src/lib.rs:2:22: error[no-comments]"),
        "{}",
        stderr(&output)
    );
}
