//! OS-level isolation backends for Tier 1 plugin workers (D8).
//!
//! Capability gating at the host API boundary stops cooperative plugins from
//! drifting beyond their manifest; it does NOT confine the worker process,
//! which can open files, sockets, and exec children regardless of what the
//! host RPC layer refuses. Real confinement is this trait's job, implemented
//! progressively: `NoSandbox` first, then a restricted-env backend, then
//! landlock/bubblewrap (Linux) and sandbox-exec (macOS). The install prompt
//! wording derives from [`SandboxBackend::isolation_summary`] so the UI never
//! overstates what is enforced.

use std::path::Path;
use std::process::Command;

pub trait SandboxBackend: Send + Sync {
    fn name(&self) -> &'static str;

    /// One honest sentence for prompts and `aoe plugin info`.
    fn isolation_summary(&self) -> &'static str;

    /// Build the worker `Command`. Implementations decide env stripping,
    /// cwd, and any wrapper executable.
    fn command(&self, entrypoint: &Path, args: &[String], workdir: &Path) -> Command;
}

/// v1 backend: spawn directly with the host's environment. No confinement.
pub struct NoSandbox;

impl SandboxBackend for NoSandbox {
    fn name(&self) -> &'static str {
        "none"
    }

    fn isolation_summary(&self) -> &'static str {
        "runs as a regular process with your user's full permissions; capability gating limits \
         only what it can ask aoe to do, not what it can do itself"
    }

    fn command(&self, entrypoint: &Path, args: &[String], workdir: &Path) -> Command {
        let mut cmd = Command::new(entrypoint);
        cmd.args(args).current_dir(workdir);
        cmd
    }
}

/// The backend used for every worker spawn in v1.
pub fn backend() -> &'static dyn SandboxBackend {
    &NoSandbox
}
