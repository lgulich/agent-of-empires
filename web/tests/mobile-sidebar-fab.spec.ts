import { test, expect } from "./helpers/mockedTest";
import { devices, type Page } from "@playwright/test";
import { clickSidebarSession, openMobileSidebar } from "./helpers/sidebar";
import { mockTerminalApis, seedSettings } from "./helpers/terminal-mocks";

// Use iPhone 13 profile: pointer:coarse, hasTouch, correct viewport, WebKit UA.
// The sidebar FAB shares the keyboard FAB's `coarse && connected` gate, so it
// only renders on a coarse pointer (#2245).
test.use({ ...devices["iPhone 13"] });

async function setup(page: Page, opts: { showSidebarFab: boolean }) {
  await mockTerminalApis(page);
  await page.route("**/api/sessions/*/ensure", (r) => r.fulfill({ json: { ok: true } }));
  await page.goto("/");
  // autoOpenKeyboard off so selecting a session doesn't pop the keyboard and
  // shift focus; this suite only exercises the sidebar FAB.
  await seedSettings(page, { autoOpenKeyboard: false, showSidebarFab: opts.showSidebarFab });
  await page.reload();
  await page.waitForTimeout(500);
  // Open the sidebar, pick a session; on mobile the select handler closes the
  // sidebar again, leaving the terminal pane (and its FABs) in view.
  await openMobileSidebar(page);
  await clickSidebarSession(page, "pinch-test");
  await page.locator("[data-live-terminal]").waitFor({ state: "visible", timeout: 10_000 });
}

async function sidebarRowX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="sidebar-session-row"]');
    return row ? (row as HTMLElement).getBoundingClientRect().x : Number.NaN;
  });
}

test.describe("Mobile sidebar FAB", () => {
  test("renders when enabled and opens the sidebar on tap", async ({ page }) => {
    await setup(page, { showSidebarFab: true });

    const fab = page.getByRole("button", { name: "Open sidebar" });
    await expect(fab).toBeVisible();

    // Sidebar is closed: its rows sit off-screen to the left (negative x).
    expect(await sidebarRowX(page)).toBeLessThan(0);

    await fab.click();

    // Tapping the FAB toggles the sidebar in: rows settle inside the viewport
    // and the FAB's aria-label flips to the close action.
    await page.waitForFunction(
      () => {
        const row = document.querySelector('[data-testid="sidebar-session-row"]');
        return !!row && (row as HTMLElement).getBoundingClientRect().x >= 0;
      },
      null,
      { timeout: 5_000 },
    );
    await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();
  });

  test("does not render when the setting is off (default)", async ({ page }) => {
    await setup(page, { showSidebarFab: false });

    // The keyboard FAB still proves the coarse-pointer FAB layer is mounted,
    // so the sidebar FAB's absence is the setting gate, not a missing surface.
    await expect(page.getByRole("button", { name: "Open keyboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open sidebar" })).toHaveCount(0);
  });
});
