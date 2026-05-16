use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const PACKAGE_NAME: &str = "cargo-thx-lint";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const LEGACY_BLOCK_NAME: &str = "@thethracian/rust-lint-config";
const RUSTFMT: &str = include_str!("../configs/rustfmt.toml");
const CLIPPY: &str = include_str!("../configs/clippy.toml");
const CARGO_LINTS_PACKAGE: &str = include_str!("../configs/cargo-lints-package.toml");
const CARGO_LINTS_WORKSPACE: &str = include_str!("../configs/cargo-lints-workspace.toml");
const DEPTH_CARGO_TOML: &str = include_str!("../configs/checks/depth/cargo_manifest.toml");
const DEPTH_LIB_RS: &str = include_str!("../configs/checks/depth/src/lib.rs");

#[derive(Debug)]
struct CliOptions {
    cwd: PathBuf,
    force: bool,
    write: bool,
}

#[derive(Debug)]
enum Command {
    Help,
    Doctor(CliOptions),
    Init(CliOptions),
    Update(CliOptions),
}

#[derive(Debug)]
struct ManagedContent<'a> {
    target: PathBuf,
    body: &'a str,
}

#[derive(Debug)]
enum Operation<'a> {
    ManagedFile(ManagedContent<'a>),
    ManagedBlock(ManagedContent<'a>),
    WriteFile { target: PathBuf, body: &'a str },
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    match parse_args(env::args_os().skip(1).collect())? {
        Command::Help => {
            print_help();
            Ok(())
        }
        Command::Doctor(options) => doctor(&options.cwd),
        Command::Init(options) | Command::Update(options) => {
            apply_operations(rust_operations(&options.cwd), &options)
        }
    }
}

fn parse_args(mut args: Vec<OsString>) -> Result<Command, String> {
    if args.first().is_some_and(|arg| arg == "thx-lint") {
        args.remove(0);
    }

    let command = args.first().and_then(|arg| arg.to_str()).unwrap_or("help");
    let options = parse_options(&args[1..])?;

    match command {
        "help" | "--help" | "-h" => Ok(Command::Help),
        "doctor" => Ok(Command::Doctor(options)),
        "init" => Ok(Command::Init(options)),
        "update" => Ok(Command::Update(options)),
        unknown => Err(format!("Unknown command: {unknown}")),
    }
}

fn parse_options(args: &[OsString]) -> Result<CliOptions, String> {
    let mut cwd =
        env::current_dir().map_err(|error| format!("Failed to read current directory: {error}"))?;
    let mut force = false;
    let mut write = false;
    let mut index = 0;

    while index < args.len() {
        let arg = args[index].to_str().ok_or("Options must be valid UTF-8.")?;
        match arg {
            "--force" => force = true,
            "--write" => write = true,
            "--cwd" => {
                index += 1;
                let value = args.get(index).ok_or("Expected a path after --cwd.")?;
                cwd = PathBuf::from(value);
            }
            unknown => return Err(format!("Unknown option: {unknown}")),
        }
        index += 1;
    }

    Ok(CliOptions {
        cwd: absolute_path(&cwd),
        force,
        write,
    })
}

fn rust_operations(cwd: &Path) -> Vec<Operation<'static>> {
    let cargo_toml = cwd.join("Cargo.toml");
    let cargo_lints = if file_contains(&cargo_toml, "[workspace]") {
        CARGO_LINTS_WORKSPACE
    } else {
        CARGO_LINTS_PACKAGE
    };

    vec![
        Operation::ManagedFile(ManagedContent {
            target: cwd.join("rustfmt.toml"),
            body: RUSTFMT,
        }),
        Operation::ManagedFile(ManagedContent {
            target: cwd.join("clippy.toml"),
            body: CLIPPY,
        }),
        Operation::ManagedBlock(ManagedContent {
            target: cargo_toml,
            body: cargo_lints,
        }),
        Operation::WriteFile {
            target: cwd.join(".thethracian-checks/depth/Cargo.toml"),
            body: DEPTH_CARGO_TOML,
        },
        Operation::WriteFile {
            target: cwd.join(".thethracian-checks/depth/src/lib.rs"),
            body: DEPTH_LIB_RS,
        },
    ]
}

fn apply_operations(operations: Vec<Operation<'_>>, options: &CliOptions) -> Result<(), String> {
    let mut planned = Vec::new();

    for operation in operations {
        match operation {
            Operation::ManagedFile(content) => {
                planned.push(format!("manage {}", content.target.display()));
                if options.write {
                    write_managed_file(&content, options.force)?;
                }
            }
            Operation::ManagedBlock(content) => {
                planned.push(format!("patch {}", content.target.display()));
                if options.write {
                    upsert_managed_block(&content)?;
                }
            }
            Operation::WriteFile { target, body } => {
                planned.push(format!("write {}", target.display()));
                if options.write {
                    write_plain_file(&target, body)?;
                }
            }
        }
    }

    let mode = if options.write { "Applied" } else { "Preview" };
    println!("{mode} {} operation(s):", planned.len());
    for line in planned {
        println!("- {line}");
    }
    if !options.write {
        println!("\nRun again with --write to apply changes.");
    }

    Ok(())
}

fn write_managed_file(content: &ManagedContent<'_>, force: bool) -> Result<(), String> {
    ensure_parent_dir(&content.target)?;
    let block = managed_block(content.body);

    if !content.target.exists() {
        return fs::write(&content.target, block).map_err(write_error(&content.target));
    }

    let current = fs::read_to_string(&content.target).map_err(read_error(&content.target))?;
    if let Some(next) = replace_owned_region(&current, &block, content.body) {
        return fs::write(&content.target, next).map_err(write_error(&content.target));
    }

    if force {
        return fs::write(&content.target, block).map_err(write_error(&content.target));
    }

    eprintln!(
        "Skipping {}; existing file is not managed by {PACKAGE_NAME}.",
        content.target.display()
    );
    Ok(())
}

fn upsert_managed_block(content: &ManagedContent<'_>) -> Result<(), String> {
    if !content.target.exists() {
        eprintln!(
            "Skipping {}; file does not exist.",
            content.target.display()
        );
        return Ok(());
    }

    let block = managed_block(content.body).trim_end().to_string();
    let current = fs::read_to_string(&content.target).map_err(read_error(&content.target))?;
    let next = replace_owned_region(&current, &block, content.body)
        .unwrap_or_else(|| format!("{}\n\n{}\n", current.trim_end(), block));

    fs::write(&content.target, next).map_err(write_error(&content.target))
}

fn write_plain_file(target: &Path, body: &str) -> Result<(), String> {
    ensure_parent_dir(target)?;
    fs::write(target, body).map_err(write_error(target))
}

fn replace_owned_region(current: &str, block: &str, body: &str) -> Option<String> {
    find_region(current, PACKAGE_NAME)
        .or_else(|| find_region(current, LEGACY_BLOCK_NAME))
        .map(|(start, end)| replace_range(current, start, end, block))
        .or_else(|| {
            if current.trim() == body.trim() {
                Some(format!("{block}\n"))
            } else {
                None
            }
        })
}

fn find_region(content: &str, block_name: &str) -> Option<(usize, usize)> {
    let begin = format!("# BEGIN {block_name}");
    let end = format!("# END {block_name}");
    let start = content.find(&begin)?;
    let relative_end = content[start..].find(&end)?;
    Some((start, start + relative_end + end.len()))
}

fn replace_range(current: &str, start: usize, end: usize, block: &str) -> String {
    format!("{}{}{}", &current[..start], block, &current[end..])
}

fn managed_block(body: &str) -> String {
    format!(
        "# BEGIN {PACKAGE_NAME}\n# VERSION {VERSION}\n{}\n# END {PACKAGE_NAME}\n",
        body.trim()
    )
}

fn doctor(cwd: &Path) -> Result<(), String> {
    for file in [
        "Cargo.toml",
        "rustfmt.toml",
        "clippy.toml",
        ".thethracian-checks/depth/Cargo.toml",
        ".thethracian-checks/depth/src/lib.rs",
    ] {
        let status = if cwd.join(file).exists() {
            "ok"
        } else {
            "missing"
        };
        println!("{status} {file}");
    }

    Ok(())
}

fn ensure_parent_dir(target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(write_error(parent))?;
    }
    Ok(())
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir().map_or_else(|_| path.to_path_buf(), |cwd| cwd.join(path))
    }
}

fn file_contains(path: &Path, needle: &str) -> bool {
    fs::read_to_string(path).is_ok_and(|content| content.contains(needle))
}

fn read_error(path: &Path) -> impl FnOnce(io::Error) -> String + '_ {
    |error| format!("Failed to read {}: {error}", path.display())
}

fn write_error(path: &Path) -> impl FnOnce(io::Error) -> String + '_ {
    |error| format!("Failed to write {}: {error}", path.display())
}

fn print_help() {
    println!(
        "\
cargo thx-lint

Usage:
  cargo thx-lint init [--write] [--force] [--cwd <path>]
  cargo thx-lint update [--write] [--force] [--cwd <path>]
  cargo thx-lint doctor [--cwd <path>]
"
    );
}
