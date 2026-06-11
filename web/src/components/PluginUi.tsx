import { useState } from "react";

import { usePluginUi } from "../hooks/usePluginUi";
import type { PluginUiBlock, PluginUiEntry, PluginUiSeverity } from "../lib/api";

/// Host-rendered plugin UI (#268 D9): plugins push typed state, these
/// components render it with core styling. No plugin code ever runs here.

const SEVERITY_TEXT: Record<PluginUiSeverity, string> = {
  info: "text-text-dim",
  success: "text-status-running",
  warning: "text-status-waiting",
  error: "text-status-error",
};

function severityText(severity?: PluginUiSeverity): string {
  return SEVERITY_TEXT[severity ?? "info"];
}

/** Small inline badge used for row badges and detail header badges. */
export function PluginBadge({ entry }: { entry: PluginUiEntry }) {
  if (entry.payload.kind !== "badge") return null;
  return (
    <span
      className={`font-mono text-[10px] px-1 py-px rounded bg-surface-700/60 ${severityText(entry.payload.severity)}`}
      title={entry.payload.tooltip || `${entry.title} (${entry.plugin_id})`}
    >
      {entry.payload.text}
    </span>
  );
}

/** Inline column cell: manifest title as the inline header. */
export function PluginCell({ entry }: { entry: PluginUiEntry }) {
  if (entry.payload.kind !== "cell") return null;
  return (
    <span
      className={`font-mono text-[10px] ${severityText(entry.payload.severity)}`}
      title={`${entry.title} (${entry.plugin_id})`}
    >
      {entry.title}:{entry.payload.text}
    </span>
  );
}

function Blocks({ blocks }: { blocks: PluginUiBlock[] }) {
  return (
    <div className="space-y-1">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <p key={i} className={`text-xs ${severityText(block.severity)}`}>
                {block.text}
              </p>
            );
          case "kv":
            return (
              <dl key={i} className="text-xs">
                {block.items.map(([k, v]) => (
                  <div key={k} className="flex gap-1">
                    <dt className="text-text-dim">{k}:</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            );
          case "list":
            return (
              <ul key={i} className="list-inside list-disc text-xs">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "metric":
            return (
              <p key={i} className="text-xs">
                <span className="text-base font-semibold">{block.value}</span>{" "}
                <span className="text-text-dim">{block.label}</span>
              </p>
            );
        }
      })}
    </div>
  );
}

function BlocksCard({ entry }: { entry: PluginUiEntry }) {
  if (entry.payload.kind !== "blocks") return null;
  return (
    <div className="rounded border border-surface-700 bg-surface-850 p-2">
      <p className={`mb-1 text-xs font-medium ${severityText(entry.payload.severity)}`}>
        {entry.title} <span className="text-text-dim font-normal">({entry.plugin_id})</span>
      </p>
      <Blocks blocks={entry.payload.blocks} />
    </div>
  );
}

/** TopBar items: status-bar segments as chips, plus a flag chip opening a
 *  popover with dashboard cards, the active session's panels, and the
 *  notification ring. */
export function PluginTopBarItems({ activeSessionId }: { activeSessionId: string | null }) {
  const ui = usePluginUi();
  const [open, setOpen] = useState(false);
  if (!ui) return null;

  const segments = ui.entries.filter((e) => e.slot === "status-bar-segment");
  const cards = ui.entries.filter((e) => e.slot === "dashboard-card");
  const panels = ui.entries.filter(
    (e) => e.slot === "session-detail-panel" && activeSessionId !== null && e.session_id === activeSessionId,
  );
  const hasPanelContent = cards.length > 0 || panels.length > 0 || ui.notifications.length > 0;
  if (segments.length === 0 && !hasPanelContent) return null;

  return (
    <>
      {segments.map((entry) =>
        entry.payload.kind === "badge" ? (
          <span
            key={`${entry.plugin_id}/${entry.contribution_id}`}
            className={`font-mono text-[11px] px-1.5 py-0.5 rounded-full bg-surface-700/50 ${severityText(entry.payload.severity)}`}
            title={entry.payload.tooltip || `${entry.title} (${entry.plugin_id})`}
          >
            {entry.payload.text}
          </span>
        ) : null,
      )}
      {hasPanelContent && (
        <div className="relative">
          <button
            type="button"
            className="font-mono text-[11px] px-1.5 py-0.5 rounded-full bg-surface-700/50 text-text-secondary hover:text-text-primary"
            aria-label="Plugin panels"
            onClick={() => setOpen((v) => !v)}
          >
            ⚑{ui.notifications.length > 0 ? ` ${ui.notifications.length}` : ""}
          </button>
          {open && (
            <div
              role="dialog"
              aria-label="Plugin panels"
              className="absolute right-0 top-8 z-50 w-80 max-h-96 overflow-y-auto rounded border border-surface-700 bg-surface-900 p-2 space-y-2 shadow-lg"
            >
              {cards.map((entry) => (
                <BlocksCard key={`${entry.plugin_id}/${entry.contribution_id}`} entry={entry} />
              ))}
              {panels.map((entry) => (
                <BlocksCard key={`${entry.plugin_id}/${entry.contribution_id}`} entry={entry} />
              ))}
              {ui.notifications.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium">Notifications</p>
                  <ul className="space-y-1">
                    {ui.notifications.map((n) => (
                      <li key={n.seq} className="text-xs">
                        <span className={severityText(n.severity)}>⚑ {n.title}</span>
                        <span className="text-text-dim"> ({n.plugin_id})</span>
                        {n.body && <span className="block text-text-dim">{n.body}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Per-session row badges and column cells for the sidebar session row. */
export function PluginSessionRowItems({ sessionId }: { sessionId: string }) {
  const ui = usePluginUi();
  if (!ui) return null;
  const badges = ui.entries.filter((e) => e.slot === "session-list-row-badge" && e.session_id === sessionId);
  const cells = ui.entries.filter((e) => e.slot === "session-list-column" && e.session_id === sessionId);
  if (badges.length === 0 && cells.length === 0) return null;
  return (
    <>
      {badges.map((entry) => (
        <PluginBadge key={`${entry.plugin_id}/${entry.contribution_id}`} entry={entry} />
      ))}
      {cells.map((entry) => (
        <PluginCell key={`${entry.plugin_id}/${entry.contribution_id}`} entry={entry} />
      ))}
    </>
  );
}
