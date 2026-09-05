use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use ra_ap_rustc_lexer::{TokenKind, strip_shebang, tokenize};
use serde::Deserialize;

#[derive(Deserialize)]
struct Metadata {
    packages: Vec<Package>,
    workspace_members: BTreeSet<String>,
    target_directory: PathBuf,
}

#[derive(Deserialize)]
struct Package {
    id: String,
    manifest_path: PathBuf,
}

pub fn check(cwd: &Path) -> Result<(), String> {
    let metadata = metadata(cwd)?;
    let mut files = BTreeSet::new();
    for package in &metadata.packages {
        if metadata.workspace_members.contains(&package.id) {
            let root = package
                .manifest_path
                .parent()
                .ok_or("Invalid manifest path")?;
            collect_sources(root, &metadata.target_directory, &mut files)?;
        }
    }
    let mut count = 0;
    for file in &files {
        let source = fs::read_to_string(file).map_err(super::read_error(file))?;
        count += report_comments(file, &source);
    }
    if count > 0 {
        return Err(format!("{count} forbidden comment(s) found"));
    }
    println!("Checked {} Rust source file(s): no comments", files.len());
    Ok(())
}

fn metadata(cwd: &Path) -> Result<Metadata, String> {
    let output = Command::new("cargo")
        .args([
            "metadata",
            "--offline",
            "--no-deps",
            "--format-version",
            "1",
        ])
        .current_dir(cwd)
        .output()
        .map_err(|error| {
            format!(
                "Failed to inspect Cargo workspace at {}: {error}",
                cwd.display()
            )
        })?;
    if !output.status.success() {
        return Err(format!(
            "Cargo metadata failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Invalid Cargo metadata: {error}"))
}

fn collect_sources(
    root: &Path,
    target: &Path,
    files: &mut BTreeSet<PathBuf>,
) -> Result<(), String> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        if directory == target {
            continue;
        }
        let entries = fs::read_dir(&directory).map_err(super::read_error(&directory))?;
        for entry in entries {
            let entry = entry.map_err(super::read_error(&directory))?;
            let path = entry.path();
            let kind = entry.file_type().map_err(super::read_error(&path))?;
            if path == target
                || ((kind.is_dir() || kind.is_symlink())
                    && matches!(
                        entry.file_name().to_str(),
                        Some(
                            ".git"
                                | "target"
                                | "deps"
                                | "vendor"
                                | ".thethracian-checks"
                                | "node_modules"
                        )
                    ))
            {
                continue;
            }
            let is_source = path.extension().is_some_and(|extension| extension == "rs");
            if kind.is_symlink() {
                let destination = fs::metadata(&path);
                if is_source
                    || destination
                        .as_ref()
                        .map_or(true, |metadata| metadata.is_dir())
                {
                    return Err(format!(
                        "{}: error[no-comments]: source symlinks are unsupported; place regular source files inside the workspace member",
                        path.display()
                    ));
                }
                continue;
            }
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file() && is_source {
                files.insert(path);
            }
        }
    }
    Ok(())
}

fn report_comments(path: &Path, source: &str) -> usize {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let start = strip_shebang(source).unwrap_or(0);
    let mut offset = start;
    let mut count = 0;
    let mut line = 1;
    let mut column = 1;
    advance_position(&source[..start], &mut line, &mut column);
    for token in tokenize(&source[start..]) {
        if matches!(
            token.kind,
            TokenKind::LineComment { .. } | TokenKind::BlockComment { .. }
        ) {
            eprintln!(
                "{}:{line}:{column}: error[no-comments]: Rust comments are forbidden",
                path.display()
            );
            count += 1;
        }
        let end = offset + token.len as usize;
        advance_position(&source[offset..end], &mut line, &mut column);
        offset = end;
    }
    count
}

fn advance_position(text: &str, line: &mut usize, column: &mut usize) {
    for character in text.chars() {
        if character == '\n' {
            *line += 1;
            *column = 1;
        } else {
            *column += 1;
        }
    }
}
