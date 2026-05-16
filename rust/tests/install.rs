use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const NEW_MARKER: &str = "# BEGIN cargo-thx-lint";
const OLD_MARKER: &str = "# BEGIN @thethracian/rust-lint-config";

#[test]
fn installs_rust_lints_into_package_projects() {
    let project = temp_project("package");
    fs::write(
        project.join("Cargo.toml"),
        [
            "[package]",
            "name = \"consumer\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::create_dir(project.join("src")).unwrap();
    fs::write(project.join("src/lib.rs"), "//! Consumer crate.\n").unwrap();

    run_thx_lint(["init", "--cwd", project.to_str().unwrap(), "--write"]);

    let cargo_toml = fs::read_to_string(project.join("Cargo.toml")).unwrap();
    let rustfmt = fs::read_to_string(project.join("rustfmt.toml")).unwrap();
    let clippy = fs::read_to_string(project.join("clippy.toml")).unwrap();

    assert!(cargo_toml.contains(NEW_MARKER));
    assert!(cargo_toml.contains("# VERSION 0.1.0"));
    assert!(cargo_toml.contains("[lints.rust]"));
    assert!(rustfmt.contains(NEW_MARKER));
    assert!(rustfmt.contains("max_width = 150"));
    assert!(clippy.contains(NEW_MARKER));
    assert!(clippy.contains("too-many-lines-threshold = 75"));
    assert!(
        project
            .join(".thethracian-checks/depth/Cargo.toml")
            .exists()
    );

    assert_success(
        Command::new("cargo")
            .args([
                "metadata",
                "--no-deps",
                "--format-version",
                "1",
                "--manifest-path",
                project.join("Cargo.toml").to_str().unwrap(),
            ])
            .output()
            .unwrap(),
    );
}

#[test]
fn reruns_replace_owned_regions_without_duplication() {
    let project = temp_project("rerun");
    fs::write(
        project.join("Cargo.toml"),
        [
            "[package]",
            "name = \"consumer\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "",
            NEW_MARKER,
            "# VERSION 0.0.1",
            "old_lint = \"deny\"",
            "# END cargo-thx-lint",
            "",
        ]
        .join("\n"),
    )
    .unwrap();

    run_thx_lint(["update", "--cwd", project.to_str().unwrap(), "--write"]);
    run_thx_lint(["update", "--cwd", project.to_str().unwrap(), "--write"]);

    let cargo_toml = fs::read_to_string(project.join("Cargo.toml")).unwrap();

    assert_eq!(cargo_toml.matches(NEW_MARKER).count(), 1);
    assert!(!cargo_toml.contains("old_lint"));
    assert!(cargo_toml.contains("# VERSION 0.1.0"));
}

#[test]
fn migrates_legacy_npm_owned_regions() {
    let project = temp_project("migrate");
    fs::write(
        project.join("Cargo.toml"),
        [
            "[package]",
            "name = \"consumer\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "",
            OLD_MARKER,
            "# VERSION 0.0.0",
            "legacy_lint = \"deny\"",
            "# END @thethracian/rust-lint-config",
            "",
        ]
        .join("\n"),
    )
    .unwrap();

    run_thx_lint(["update", "--cwd", project.to_str().unwrap(), "--write"]);

    let cargo_toml = fs::read_to_string(project.join("Cargo.toml")).unwrap();

    assert!(cargo_toml.contains(NEW_MARKER));
    assert!(!cargo_toml.contains(OLD_MARKER));
    assert!(!cargo_toml.contains("legacy_lint"));
    assert_eq!(cargo_toml.matches(NEW_MARKER).count(), 1);
}

#[test]
fn installed_lints_are_enforced_by_cargo_clippy() {
    let project = temp_project("clippy");
    fs::write(
        project.join("Cargo.toml"),
        [
            "[package]",
            "name = \"consumer\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "",
        ]
        .join("\n"),
    )
    .unwrap();
    fs::create_dir(project.join("src")).unwrap();
    fs::write(
        project.join("src/lib.rs"),
        [
            "//! Consumer crate.",
            "",
            "/// Emits a forbidden debug artifact.",
            "pub fn noisy() {",
            "    println!(\"bad\");",
            "}",
            "",
        ]
        .join("\n"),
    )
    .unwrap();

    run_thx_lint(["init", "--cwd", project.to_str().unwrap(), "--write"]);

    let output = Command::new("cargo")
        .args([
            "clippy",
            "--manifest-path",
            project.join("Cargo.toml").to_str().unwrap(),
            "--",
            "-D",
            "warnings",
        ])
        .output()
        .unwrap();

    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(!output.status.success());
    assert!(stderr.contains("print_stdout"));
    assert!(!stderr.contains("unknown lint"));
}

fn run_thx_lint<const N: usize>(args: [&str; N]) {
    assert_success(
        Command::new(env!("CARGO_BIN_EXE_cargo-thx-lint"))
            .args(args)
            .output()
            .unwrap(),
    );
}

fn assert_success(output: std::process::Output) {
    assert!(
        output.status.success(),
        "command failed\nstatus: {}\nstdout:\n{}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn temp_project(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("cargo-thx-lint-{name}-{}", unique_id()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn unique_id() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}
