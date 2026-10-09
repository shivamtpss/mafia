import { test, expect, Browser, Page } from '@playwright/test';

/**
 * End-to-end acceptance test driving the REAL rendered UI in two independent
 * browser contexts (two "tabs"/players) against the running server + web build.
 * This exercises the actual end-user path: click Play → create/join → ready →
 * host start, and asserts that DOM in BOTH tabs reflects authoritative server
 * broadcasts.
 */

async function freshPlayer(browser: Browser, name: string): Promise<Page> {
  // Separate context = separate localStorage/session = a distinct player.
  const context = await browser.newContext();
  const page = await context.newPage();
  return page;
}

async function pickIdentity(page: Page, name: string) {
  const input = page.getByPlaceholder('e.g. Nightshade');
  await input.waitFor({ state: 'visible' });
  await input.fill(name);
}

test('landing page renders and routes to Play', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AI MAFIA' })).toBeVisible();
  await page.getByRole('link', { name: 'Play Now' }).click();
  await expect(page.getByText('Enter the city')).toBeVisible();
});

test('two players: create + join + ready + host start, synced live', async ({
  browser,
}) => {
  const host = await freshPlayer(browser, 'Alice');
  const guest = await freshPlayer(browser, 'Bob');

  // --- Host creates a room ---
  await host.goto('/play');
  await host.getByRole('button', { name: 'Create a room' }).click();
  await pickIdentity(host, 'Alice');
  await host.getByRole('button', { name: 'Create room' }).click();

  // Lands in the room; URL carries the code.
  await host.waitForURL(/\/room\/[A-Z0-9]{5}$/, { timeout: 15_000 });
  const code = host.url().split('/room/')[1];
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // Host sees themselves and the host badge in the rendered DOM.
  await expect(host.getByText('Alice', { exact: true }).first()).toBeVisible();
  await expect(host.getByText('★ Host').first()).toBeVisible();

  // --- Guest joins by code ---
  await guest.goto(`/play?mode=join&code=${code}`);
  await guest.getByPlaceholder('ABCDE').waitFor({ state: 'visible' });
  await pickIdentity(guest, 'Bob');
  await guest.getByRole('button', { name: 'Join room' }).click();
  await guest.waitForURL(new RegExp(`/room/${code}$`), { timeout: 15_000 });

  // --- Live sync: the host tab should now show Bob WITHOUT a reload ---
  await expect(host.getByText('Bob', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // And the guest sees the host.
  await expect(guest.getByText('Alice', { exact: true }).first()).toBeVisible();

  // --- Realtime chat broadcast across tabs ---
  const hostChat = host.getByPlaceholder('Say something…');
  await hostChat.fill('hello from host');
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByText('hello from host')).toBeVisible({
    timeout: 10_000,
  });

  // --- Authoritative guard: host cannot start with < min players ---
  // Only 2 of 4 present, so the Start button is disabled.
  const startBtn = host.getByRole('button', { name: 'Start game' });
  await expect(startBtn).toBeDisabled();

  // --- Add two more players to reach the minimum (4) ---
  const c = await freshPlayer(browser, 'Cara');
  const d = await freshPlayer(browser, 'Dan');
  for (const [pg, nm] of [
    [c, 'Cara'],
    [d, 'Dan'],
  ] as const) {
    await pg.goto(`/play?mode=join&code=${code}`);
    await pg.getByPlaceholder('ABCDE').waitFor({ state: 'visible' });
    await pickIdentity(pg, nm);
    await pg.getByRole('button', { name: 'Join room' }).click();
    await pg.waitForURL(new RegExp(`/room/${code}$`), { timeout: 15_000 });
  }

  // Everyone non-host readies up via the real button.
  for (const pg of [guest, c, d]) {
    await pg.getByRole('button', { name: "I'm ready" }).click();
  }

  // Host sees "4/4 ready" style count and can now start.
  await expect(startBtn).toBeEnabled({ timeout: 10_000 });
  await startBtn.click();

  // --- All tabs transition to the ROLE REVEAL phase via server broadcast ---
  for (const pg of [host, guest, c, d]) {
    await expect(pg.getByText('ROLE REVEAL').first()).toBeVisible({
      timeout: 10_000,
    });
  }

  // Cleanup.
  for (const pg of [host, guest, c, d]) {
    await pg.context().close();
  }
});

test('reconnect: refreshing the room tab reclaims the same seat', async ({
  browser,
}) => {
  const host = await freshPlayer(browser, 'Solo');
  await host.goto('/play');
  await host.getByRole('button', { name: 'Create a room' }).click();
  await pickIdentity(host, 'Solo');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}$/, { timeout: 15_000 });
  const code = host.url().split('/room/')[1];

  // Reload the page — the stored session should reclaim the seat.
  await host.reload();
  await expect(host.getByText('Solo', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(host).toHaveURL(new RegExp(`/room/${code}$`));

  await host.context().close();
});
