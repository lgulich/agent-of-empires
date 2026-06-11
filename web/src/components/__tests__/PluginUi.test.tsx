// @vitest-environment jsdom
//
// Contract test for the host-rendered plugin UI components (#268 D9): the
// shared poller maps /api/ui/state entries to top-bar segments, the
// notification flag and popover, and per-session row badges/cells. No
// plugin code runs in the dashboard; these render typed payloads only.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import type { PluginUiState } from "../../lib/api";

const fetchPluginUiState = vi.fn<[], Promise<PluginUiState | null>>();

vi.mock("../../lib/api", () => ({
  fetchPluginUiState: () => fetchPluginUiState(),
}));

import { PluginSessionRowItems, PluginTopBarItems } from "../PluginUi";
import { resetPluginUiStoreForTests } from "../../hooks/usePluginUi";

function state(): PluginUiState {
  return {
    revision: 1,
    entries: [
      {
        plugin_id: "acme.attention",
        contribution_id: "summary",
        slot: "status-bar-segment",
        title: "Attention",
        priority: 50,
        payload: { kind: "badge", text: "3 need attention", severity: "warning" },
      },
      {
        plugin_id: "acme.attention",
        contribution_id: "badge",
        slot: "session-list-row-badge",
        title: "Attention",
        priority: 50,
        session_id: "s1",
        payload: { kind: "badge", text: "blocked", severity: "error" },
      },
      {
        plugin_id: "acme.triage",
        contribution_id: "risk",
        slot: "session-list-column",
        title: "Risk",
        priority: 10,
        session_id: "s1",
        payload: { kind: "cell", text: "high", severity: "warning" },
      },
      {
        plugin_id: "acme.attention",
        contribution_id: "card",
        slot: "dashboard-card",
        title: "Attention overview",
        priority: 50,
        payload: {
          kind: "blocks",
          blocks: [{ type: "metric", label: "need review", value: "3" }],
        },
      },
    ],
    notifications: [
      {
        plugin_id: "acme.attention",
        title: "Session blocked",
        body: "frontend-agent has no output for 12m.",
        severity: "warning",
        seq: 1,
      },
    ],
  };
}

beforeEach(() => {
  resetPluginUiStoreForTests();
  fetchPluginUiState.mockReset();
  fetchPluginUiState.mockResolvedValue(state());
});

describe("PluginUi contract", () => {
  it("renders status-bar segments and opens the panels popover", async () => {
    const { findByText, findByRole } = render(<PluginTopBarItems activeSessionId={null} />);
    await findByText("3 need attention");

    fireEvent.click(await findByText("⚑ 1"));
    const popover = await findByRole("dialog");
    expect(popover.textContent).toContain("Attention overview");
    expect(popover.textContent).toContain("need review");
    expect(popover.textContent).toContain("Session blocked");
    expect(popover.textContent).toContain("frontend-agent has no output for 12m.");
  });

  it("renders per-session badges and column cells for the right session only", async () => {
    const { findByText } = render(<PluginSessionRowItems sessionId="s1" />);
    await findByText("blocked");
    await findByText("Risk:high");

    const other = render(<PluginSessionRowItems sessionId="s2" />);
    await waitFor(() => {
      expect(other.container.textContent).toBe("");
    });
  });
});
