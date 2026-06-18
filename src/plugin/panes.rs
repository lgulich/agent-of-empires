//! Plugin-owned terminal panes (#268 extension points): a plugin declares a
//! `[[panes]]` command; the host runs it in a dedicated tmux session with the
//! plugin install root as cwd and discrete `AOE_PLUGIN_*` env injected. The
//! TUI attaches to that session; the web dashboard relays it as a full
//! terminal. Panes are ephemeral: an in-memory registry tracks the open ones,
//! a startup sweep kills any stray pane sessions, and a registry reload evicts
//! panes whose plugin is no longer active.
//!
//! Plugin panes are deliberately NOT `Instance`s and never touch
//! `sessions.json`, so no session-enumerating surface (sidebar, batch ops,
//! telemetry, status detection) can mistake one for a real agent session.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{anyhow, bail, Result};
use aoe_plugin_api::Capability;
use tracing::warn;

use super::LockSafe;
use crate::tmux::PLUGIN_PANE_PREFIX;

/// One open plugin pane, keyed in the registry by its tmux session name.
struct OpenPane {
    plugin_id: String,
    pane_id: String,
    session_id: Option<String>,
    title: String,
}

/// Context resolved by the caller (server or TUI) for env injection.
#[derive(Default)]
pub struct PaneContext {
    pub session_id: Option<String>,
    pub worktree: Option<String>,
}

/// What `open` returns: the handle (the tmux session name) plus the title.
pub struct OpenedPane {
    pub handle: String,
    pub title: String,
}

static OPEN_PANES: Mutex<Option<HashMap<String, OpenPane>>> = Mutex::new(None);

/// Safety ceiling on concurrently-open plugin panes across all plugins and
/// sessions. The (plugin, pane, session) dedup already collapses repeat opens;
/// this backstops a client that asks to open many distinct panes from spawning
/// unbounded detached tmux sessions.
const MAX_OPEN_PANES: usize = 64;

fn with_registry<R>(f: impl FnOnce(&mut HashMap<String, OpenPane>) -> R) -> R {
    let mut guard = OPEN_PANES.lock_safe();
    f(guard.get_or_insert_with(HashMap::new))
}

/// Deterministic, leak-free tmux session name for a pane: a hash of the
/// identifying tuple under the plugin-pane prefix. Same tuple always maps to
/// the same name, which is what makes "open the same pane twice" dedup to one
/// tmux session without a separate handle table.
fn pane_session_name(plugin_id: &str, pane_id: &str, session_id: Option<&str>) -> String {
    let mut hasher = DefaultHasher::new();
    plugin_id.hash(&mut hasher);
    pane_id.hash(&mut hasher);
    session_id.unwrap_or("").hash(&mut hasher);
    format!("{PLUGIN_PANE_PREFIX}{:016x}", hasher.finish())
}

/// Open (or refocus) a plugin pane. Validates the plugin is active, declares
/// the pane, and holds the `terminal-pane` capability, then spawns a detached
/// tmux session running the pane command unless one already exists for this
/// (plugin, pane, session) tuple. Returns the tmux session name as the handle.
pub fn open(plugin_id: &str, pane_id: &str, ctx: &PaneContext) -> Result<OpenedPane> {
    let registry = super::registry();
    let plugin = registry
        .get(plugin_id)
        .filter(|p| p.active())
        .ok_or_else(|| anyhow!("plugin {plugin_id} is not active"))?;
    if !plugin
        .manifest
        .capabilities
        .contains(&Capability::TerminalPane)
    {
        bail!("plugin {plugin_id} does not hold the terminal-pane capability");
    }
    let pane = plugin
        .manifest
        .panes
        .iter()
        .find(|p| p.id == pane_id)
        .ok_or_else(|| anyhow!("plugin {plugin_id} declares no pane {pane_id:?}"))?;
    let root = plugin
        .root
        .as_ref()
        .ok_or_else(|| anyhow!("plugin {plugin_id} has no install root to run a pane from"))?;

    let name = pane_session_name(plugin_id, pane_id, ctx.session_id.as_deref());
    let title = pane.title.clone();

    // Dedup: a live session for this tuple is refocused, not re-spawned.
    if tmux_has_session(&name) {
        with_registry(|reg| {
            reg.entry(name.clone()).or_insert_with(|| OpenPane {
                plugin_id: plugin_id.to_string(),
                pane_id: pane_id.to_string(),
                session_id: ctx.session_id.clone(),
                title: title.clone(),
            });
        });
        return Ok(OpenedPane {
            handle: name,
            title,
        });
    }

    // Backstop runaway pane creation. The dedup above means this only counts
    // distinct (plugin, pane, session) tuples; a refocus never reaches here.
    let live = with_registry(|reg| reg.len());
    if live >= MAX_OPEN_PANES {
        bail!("too many plugin panes open ({live}); close some before opening more");
    }

    let env = [
        ("AOE_PLUGIN_ID", plugin_id.to_string()),
        ("AOE_PLUGIN_ROOT", root.display().to_string()),
        ("AOE_PANE_ID", pane_id.to_string()),
        ("AOE_SESSION_ID", ctx.session_id.clone().unwrap_or_default()),
        ("AOE_WORKTREE", ctx.worktree.clone().unwrap_or_default()),
    ];
    spawn_detached(&name, root, &pane.command, &env)?;

    with_registry(|reg| {
        reg.insert(
            name.clone(),
            OpenPane {
                plugin_id: plugin_id.to_string(),
                pane_id: pane_id.to_string(),
                session_id: ctx.session_id.clone(),
                title: title.clone(),
            },
        );
    });
    Ok(OpenedPane {
        handle: name,
        title,
    })
}

/// True when `handle` is a registered open plugin pane. The web WS route uses
/// this to gate attach so a client cannot relay an arbitrary tmux session.
pub fn is_open(handle: &str) -> bool {
    with_registry(|reg| reg.contains_key(handle))
}

/// Close a pane: kill its tmux session and drop the registry entry.
pub fn close(handle: &str) -> Result<()> {
    let existed = with_registry(|reg| reg.remove(handle).is_some());
    if existed {
        kill_session(handle);
    }
    Ok(())
}

/// An open-pane descriptor for the listing endpoint.
pub struct PaneListEntry {
    pub handle: String,
    pub plugin_id: String,
    pub pane_id: String,
    pub session_id: Option<String>,
    pub title: String,
}

/// Every open plugin pane, so a refreshed dashboard can re-discover and
/// re-attach. Prunes entries whose tmux session has since died.
pub fn list_open() -> Vec<PaneListEntry> {
    with_registry(|reg| {
        reg.retain(|name, _| tmux_has_session(name));
        reg.iter()
            .map(|(handle, p)| PaneListEntry {
                handle: handle.clone(),
                plugin_id: p.plugin_id.clone(),
                pane_id: p.pane_id.clone(),
                session_id: p.session_id.clone(),
                title: p.title.clone(),
            })
            .collect()
    })
}

/// Kill and forget every pane whose plugin is not in `active`. Called from
/// `reload_registry` so a disabled/uninstalled/grant-revoked plugin's panes
/// die with it.
pub fn evict_except(active: &std::collections::HashSet<String>) {
    let killed = with_registry(|reg| {
        let mut killed = Vec::new();
        reg.retain(|name, p| {
            if active.contains(&p.plugin_id) {
                true
            } else {
                killed.push(name.clone());
                false
            }
        });
        killed
    });
    for name in killed {
        kill_session(&name);
    }
}

/// Kill and forget every pane bound to a now-deleted agent session.
pub fn evict_session(session_id: &str) {
    let killed = with_registry(|reg| {
        let mut killed = Vec::new();
        reg.retain(|name, p| {
            if p.session_id.as_deref() == Some(session_id) {
                killed.push(name.clone());
                false
            } else {
                true
            }
        });
        killed
    });
    for name in killed {
        kill_session(&name);
    }
}

/// Kill stray plugin-pane tmux sessions left over from a previous daemon and
/// start with an empty registry. Plugin panes are ephemeral: their process
/// state is not checkpointable across a restart, so they are not re-adopted.
pub fn sweep_orphans() {
    for name in list_pane_sessions() {
        kill_session(&name);
    }
    with_registry(|reg| reg.clear());
}

fn spawn_detached(
    name: &str,
    cwd: &std::path::Path,
    command: &[String],
    env: &[(&str, String)],
) -> Result<()> {
    let mut args: Vec<String> = vec![
        "new-session".into(),
        "-d".into(),
        "-s".into(),
        name.into(),
        "-c".into(),
        cwd.display().to_string(),
    ];
    for (k, v) in env {
        args.push("-e".into());
        args.push(format!("{k}={v}"));
    }
    // Trailing args are the command argv, run directly by tmux (no shell).
    args.extend(command.iter().cloned());
    let output = Command::new("tmux").args(&args).output()?;
    if !output.status.success() {
        bail!(
            "tmux new-session failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    crate::tmux::refresh_session_cache();
    Ok(())
}

fn tmux_has_session(name: &str) -> bool {
    Command::new("tmux")
        .args(["has-session", "-t", name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn kill_session(name: &str) {
    if let Err(e) = Command::new("tmux")
        .args(["kill-session", "-t", name])
        .output()
    {
        warn!(target: "plugin", session = %name, "killing plugin pane session failed: {e}");
    }
    crate::tmux::refresh_session_cache();
}

fn list_pane_sessions() -> Vec<String> {
    let output = match Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        // No server / no sessions: nothing to sweep.
        _ => return Vec::new(),
    };
    String::from_utf8_lossy(&output)
        .lines()
        .filter(|n| n.starts_with(PLUGIN_PANE_PREFIX))
        .map(|n| n.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_name_is_stable_and_tuple_sensitive() {
        let a = pane_session_name("acme", "logs", Some("s1"));
        let b = pane_session_name("acme", "logs", Some("s1"));
        let c = pane_session_name("acme", "logs", Some("s2"));
        let d = pane_session_name("acme", "shell", Some("s1"));
        assert_eq!(a, b, "same tuple -> same name (dedup)");
        assert_ne!(a, c, "different session -> different name");
        assert_ne!(a, d, "different pane -> different name");
        assert!(a.starts_with(PLUGIN_PANE_PREFIX));
    }
}
