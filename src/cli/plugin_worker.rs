//! Hidden `aoe __plugin-worker --id <id>`: the Tier 1 worker for builtin
//! plugins. A single installed binary ships every first-party worker; the
//! plugin host spawns this subcommand with piped stdio and speaks ndjson
//! JSON-RPC (see `src/plugin/host.rs`).
//!
//! Workers exit on stdin EOF, which is how the host (or a crashed host's
//! closed pipe) shuts them down.

use std::io::{BufRead, Write};

use anyhow::Result;
use clap::Args;
use serde_json::{json, Value};

#[derive(Args)]
pub struct PluginWorkerArgs {
    /// Builtin plugin id this worker serves, e.g. `aoe.status`.
    #[arg(long)]
    pub id: String,
}

pub fn run(args: PluginWorkerArgs) -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = msg.get("id").and_then(Value::as_u64) else {
            // Notifications (e.g. events.event) need no reply; builtin
            // workers currently subscribe to nothing.
            continue;
        };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let response = match handle(&args.id, method, params) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(e) => json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": format!("{e:#}") },
            }),
        };
        let mut out = stdout.lock();
        writeln!(out, "{response}")?;
        out.flush()?;
    }
    Ok(())
}

fn handle(plugin_id: &str, method: &str, params: Value) -> Result<Value> {
    match (plugin_id, method) {
        ("aoe.status", "status.detect_batch") => detect_batch(params),
        _ => anyhow::bail!("builtin worker {plugin_id} does not handle {method}"),
    }
}

/// Batched codex detection: one result per snapshot, errors isolated per
/// snapshot so one bad pane never fails its siblings.
fn detect_batch(params: Value) -> Result<Value> {
    let snapshots = params
        .get("snapshots")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let results: Vec<Value> = snapshots
        .iter()
        .map(|snap| {
            let session_id = snap.get("session_id").and_then(Value::as_str).unwrap_or("");
            let agent = snap.get("agent").and_then(Value::as_str).unwrap_or("");
            let pane_text = snap.get("pane_text").and_then(Value::as_str).unwrap_or("");
            match agent {
                "codex" => {
                    let status = crate::tmux::status_detection::detect_codex_status(pane_text);
                    json!({ "session_id": session_id, "status": status.as_str() })
                }
                other => json!({
                    "session_id": session_id,
                    "error": format!("aoe.status worker has no parser for agent {other:?}"),
                }),
            }
        })
        .collect();
    Ok(json!({ "results": results }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_batch_isolates_per_snapshot_errors() {
        let result = detect_batch(json!({ "snapshots": [
            { "session_id": "s1", "agent": "codex", "pane_text": "Working (esc to interrupt)" },
            { "session_id": "s2", "agent": "made-up", "pane_text": "x" },
        ]}))
        .unwrap();
        let results = result["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].get("status").is_some());
        assert_eq!(results[1]["session_id"], "s2");
        assert!(results[1].get("error").is_some());
    }
}
