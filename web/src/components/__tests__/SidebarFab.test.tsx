// @vitest-environment jsdom
//
// Behavior contract for the mobile sidebar FAB (#2245): the aria-label
// reflects sidebar state, the click toggles, and pointer-down is prevented
// so tapping it does not blur the terminal input / dismiss the keyboard.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { SidebarFab } from "../SidebarFab";

describe("SidebarFab", () => {
  it("labels the action 'Open sidebar' when closed", () => {
    const { getByRole } = render(<SidebarFab sidebarOpen={false} onToggle={() => {}} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Open sidebar");
  });

  it("labels the action 'Close sidebar' when open", () => {
    const { getByRole } = render(<SidebarFab sidebarOpen onToggle={() => {}} />);
    expect(getByRole("button").getAttribute("aria-label")).toBe("Close sidebar");
  });

  it("fires onToggle on click", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(<SidebarFab sidebarOpen={false} onToggle={onToggle} />);
    fireEvent.click(getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("prevents default on pointer-down to keep terminal focus", () => {
    const { getByRole } = render(<SidebarFab sidebarOpen={false} onToggle={() => {}} />);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    getByRole("button").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
