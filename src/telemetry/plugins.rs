//! Plugin adoption signal (#268): which plugins this install runs.
//!
//! Same allowlist discipline as [`super::features`] and
//! [`super::sanitize`]: plugin identity reaches the wire only for a closed,
//! publicly known set, the builtin plugins compiled into this binary plus
//! the curated featured index embedded from `plugins/featured.toml`. Any
//! other install (an unfeatured GitHub repository, which may be private, or
//! a local directory) is counted in the coarse per-source census and never
//! identified; no slug, path, or free-form id ever leaves the machine.

use std::collections::BTreeMap;

use crate::plugin::{registry, PluginSource};

/// The two shallow maps the usage snapshot carries.
pub struct PluginAdoption {
    /// Closed source key (`builtin` / `github` / `path`) -> installed
    /// plugin count. All three keys are always present (pre-seeded to 0)
    /// so the wire key set is stable, like `sessions_by_substrate`.
    pub by_source: BTreeMap<String, u32>,
    /// Allowlisted plugin id -> whether it is active (enabled AND its
    /// capability grant matches the current manifest). Builtin ids are
    /// always present; featured ids appear only while installed.
    pub active: BTreeMap<String, bool>,
}

/// Snapshot the current plugin registry into the two adoption maps.
pub fn plugin_adoption() -> PluginAdoption {
    let reg = registry();
    adoption_from(reg.all().iter().map(|p| {
        (
            p.id().to_string(),
            p.source.clone(),
            p.active(),
            crate::plugin::featured::index().contains_id(p.id()),
        )
    }))
}

/// Pure core, unit-testable without the global registry: each entry is
/// (plugin id, source, active, id-is-in-featured-index).
fn adoption_from(
    plugins: impl Iterator<Item = (String, PluginSource, bool, bool)>,
) -> PluginAdoption {
    let mut by_source: BTreeMap<String, u32> = ["builtin", "github", "path"]
        .into_iter()
        .map(|k| (k.to_string(), 0))
        .collect();
    let mut active = BTreeMap::new();
    for (id, source, is_active, featured) in plugins {
        let (key, allowlisted) = match source {
            PluginSource::Builtin => ("builtin", true),
            // Identity only for curated featured plugins: an unfeatured
            // GitHub source can be a private repository, so its slug and
            // manifest id stay off the wire.
            PluginSource::GitHub { .. } => ("github", featured),
            PluginSource::Path { .. } => ("path", false),
        };
        *by_source.get_mut(key).expect("pre-seeded source key") += 1;
        if allowlisted {
            active.insert(id, is_active);
        }
    }
    PluginAdoption { by_source, active }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(entries: Vec<(&str, PluginSource, bool, bool)>) -> PluginAdoption {
        adoption_from(
            entries
                .into_iter()
                .map(|(id, source, active, featured)| (id.to_string(), source, active, featured)),
        )
    }

    #[test]
    fn builtin_ids_are_reported_with_active_state() {
        let adoption = run(vec![
            ("aoe.status", PluginSource::Builtin, true, false),
            ("aoe.web", PluginSource::Builtin, false, false),
        ]);
        assert_eq!(adoption.active.get("aoe.status"), Some(&true));
        assert_eq!(adoption.active.get("aoe.web"), Some(&false));
        assert_eq!(adoption.by_source.get("builtin"), Some(&2));
    }

    #[test]
    fn unfeatured_installs_are_counted_but_never_identified() {
        let adoption = run(vec![
            (
                "secret.plugin",
                PluginSource::GitHub {
                    slug: "corp/private-repo".into(),
                },
                true,
                false,
            ),
            (
                "local.thing",
                PluginSource::Path {
                    path: "/home/u/dev/plugin".into(),
                },
                true,
                false,
            ),
        ]);
        assert!(adoption.active.is_empty());
        assert_eq!(adoption.by_source.get("github"), Some(&1));
        assert_eq!(adoption.by_source.get("path"), Some(&1));
        // No value derived from the slug or path may appear anywhere.
        let keys: Vec<_> = adoption.active.keys().collect();
        assert!(keys.is_empty(), "{keys:?}");
    }

    #[test]
    fn featured_github_plugins_are_identified() {
        let adoption = run(vec![(
            "acme.review",
            PluginSource::GitHub {
                slug: "acme/aoe-review".into(),
            },
            true,
            true,
        )]);
        assert_eq!(adoption.active.get("acme.review"), Some(&true));
        assert_eq!(adoption.by_source.get("github"), Some(&1));
    }

    #[test]
    fn source_keys_are_always_present() {
        let adoption = run(vec![]);
        assert_eq!(adoption.by_source.get("builtin"), Some(&0));
        assert_eq!(adoption.by_source.get("github"), Some(&0));
        assert_eq!(adoption.by_source.get("path"), Some(&0));
    }
}
