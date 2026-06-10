//! E2E coverage for the plugin management CLI (#268): list shows the bundled
//! plugins with trust and state, enable/disable round-trips through config,
//! info prints capabilities, settings explain prints provenance, and the
//! contributed worker answers a status batch.

use serial_test::serial;

use crate::harness::TuiTestHarness;

#[test]
#[serial]
fn test_plugin_list_shows_builtins_with_trust_and_state() {
    let h = TuiTestHarness::new("plugin_list");
    let output = h.run_cli(&["plugin", "list"]);
    assert!(
        output.status.success(),
        "aoe plugin list failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("aoe.status"),
        "missing aoe.status:\n{stdout}"
    );
    assert!(
        stdout.contains("builtin"),
        "missing builtin trust label:\n{stdout}"
    );
    assert!(
        stdout.contains("enabled"),
        "missing state column:\n{stdout}"
    );
}

#[test]
#[serial]
fn test_plugin_disable_enable_round_trip() {
    let h = TuiTestHarness::new("plugin_toggle");

    let disable = h.run_cli(&["plugin", "disable", "aoe.status"]);
    assert!(
        disable.status.success(),
        "disable failed: {}",
        String::from_utf8_lossy(&disable.stderr)
    );
    let list = h.run_cli(&["plugin", "list"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    let status_line = stdout
        .lines()
        .find(|l| l.contains("aoe.status"))
        .unwrap_or_else(|| panic!("aoe.status missing from list:\n{stdout}"));
    assert!(
        status_line.contains("disabled"),
        "aoe.status should be disabled:\n{status_line}"
    );

    let enable = h.run_cli(&["plugin", "enable", "aoe.status"]);
    assert!(
        enable.status.success(),
        "enable failed: {}",
        String::from_utf8_lossy(&enable.stderr)
    );
    let list = h.run_cli(&["plugin", "list"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    let status_line = stdout.lines().find(|l| l.contains("aoe.status")).unwrap();
    assert!(
        status_line.contains("enabled") && !status_line.contains("disabled"),
        "aoe.status should be enabled again:\n{status_line}"
    );
}

#[test]
#[serial]
fn test_plugin_info_prints_capabilities_and_runtime() {
    let h = TuiTestHarness::new("plugin_info");
    let output = h.run_cli(&["plugin", "info", "aoe.status"]);
    assert!(
        output.status.success(),
        "info failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("pane-read"),
        "capabilities missing:\n{stdout}"
    );
    assert!(
        stdout.contains("JSON-RPC worker"),
        "runtime line missing:\n{stdout}"
    );
}

#[test]
#[serial]
fn test_settings_explain_resolves_plugin_default() {
    let h = TuiTestHarness::new("plugin_settings_explain");
    let output = h.run_cli(&["settings", "explain", "aoe.status.custom_agent_rules"]);
    assert!(
        output.status.success(),
        "settings explain failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    // No user value set: the manifest default wins and the chain says so.
    assert!(
        stdout.contains("manifest default"),
        "expected manifest-default provenance:\n{stdout}"
    );
    assert!(
        stdout.contains("true"),
        "expected the default value in the output:\n{stdout}"
    );
}

#[test]
#[serial]
fn test_builtin_worker_answers_status_batch() {
    let h = TuiTestHarness::new("plugin_worker_batch");
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"status.detect_batch","params":{"snapshots":[{"session_id":"s1","agent":"codex","pane_text":"Working (esc to interrupt)"}]}}"#;
    let output = h.run_cli_with_stdin(&["__plugin-worker", "--id", "aoe.status"], request);
    assert!(
        output.status.success(),
        "worker failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("\"session_id\":\"s1\"") && stdout.contains("\"status\""),
        "expected a per-snapshot result:\n{stdout}"
    );
}
