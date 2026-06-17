// @vitest-environment jsdom
//
// The paired terminal is the "terminal" of a structured/ACP session. The
// mobile sidebar FAB lives in LiveTerminalView and only renders when an
// onToggleSidebar callback is threaded in, so PairedShellPane must forward
// the sidebar props or the FAB silently never shows there (#2245).

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const liveProps: Array<Record<string, unknown>> = [];
vi.mock("../LiveTerminalView", () => ({
  LiveTerminalView: (props: Record<string, unknown>) => {
    liveProps.push(props);
    return null;
  },
}));

import { PairedShellPane } from "../PairedTerminal";
import type { SessionResponse } from "../../lib/types";

const session = { id: "s1", is_sandboxed: false } as unknown as SessionResponse;

describe("PairedShellPane", () => {
  it("forwards sidebar open state and toggle to LiveTerminalView", () => {
    liveProps.length = 0;
    const onToggleSidebar = vi.fn();
    render(<PairedShellPane session={session} sessionId="s1" sidebarOpen onToggleSidebar={onToggleSidebar} />);

    expect(liveProps).toHaveLength(1);
    expect(liveProps[0].sidebarOpen).toBe(true);
    expect(liveProps[0].onToggleSidebar).toBe(onToggleSidebar);
  });
});
