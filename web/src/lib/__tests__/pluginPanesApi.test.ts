// Contract test for the plugin terminal pane api-client wrappers (#268). These
// are otherwise only exercised by the live right-panel terminal, whose coverage
// does not feed the Vitest patch lane, so the request payloads, paths, and the
// network-failure fallbacks are locked in here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closePluginPane, listPluginPanes, openPluginPane } from "../api";

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plugin pane api client", () => {
  it("openPluginPane posts session_id and returns the handle", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        handle: "aoe_pane_abc",
        plugin_id: "acme",
        pane_id: "logs",
        session_id: "s1",
        title: "Logs",
        ws_path: "/api/plugin-panes/aoe_pane_abc/ws",
      }),
    );
    const opened = await openPluginPane("acme", "logs", "s1");
    expect(opened?.handle).toBe("aoe_pane_abc");
    expect(opened?.ws_path).toBe("/api/plugin-panes/aoe_pane_abc/ws");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/plugins/acme/panes/logs/open");
    const body = init as RequestInit;
    expect(body.method).toBe("POST");
    expect(JSON.parse(body.body as string)).toEqual({ session_id: "s1" });
  });

  it("openPluginPane returns null on a non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "x" }, 403));
    expect(await openPluginPane("acme", "logs", "s1")).toBeNull();
  });

  it("listPluginPanes unwraps the panes array, defaulting to empty", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ panes: [{ handle: "h1" }] }));
    expect(await listPluginPanes()).toHaveLength(1);
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 500));
    expect(await listPluginPanes()).toEqual([]);
  });

  it("closePluginPane DELETEs the handle and reports ok", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ closed: true }));
    expect(await closePluginPane("aoe_pane_abc")).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/plugin-panes/aoe_pane_abc");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
