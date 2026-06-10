//! Tier 1 plugin runtime: dispatching contributed actions and commands to
//! the plugin's JSON-RPC worker.
//!
//! This module is the single entry point every surface (TUI keybinds, CLI
//! grafted commands, web action routes) calls to run plugin code. The heavy
//! lifting (spawn, supervision, capability middleware) lives in
//! [`super::host`].

use anyhow::Result;
use serde_json::Value;

/// Invoke a plugin-contributed action or command over the plugin's worker.
pub fn invoke_action(plugin_id: &str, rpc_method: &str, params: Value) -> Result<Value> {
    super::host::host().call(plugin_id, rpc_method, params)
}
