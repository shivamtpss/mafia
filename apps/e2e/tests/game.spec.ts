import { test, expect, Browser, Page } from '@playwright/test';

/**
 * Full-game acceptance test: four real browser players play a complete match
 * through the rendered UI — role reveal, night actions, day, voting, and the
 * results screen — driven entirely by server broadcasts. Phase durations are
 * shortened via env (see playwright.config.ts).
 */

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/play');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await page.getByPlaceholder('e.g. Nightshade').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{5}$/, { timeout: 15_000 });
  return page.url().split('/room/')[1];
}

async function joinRoom(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/play?mode=join&code=${code}`);
  await page.getByPlaceholder('ABCDE').waitFor({ state: 'visible' });
  await page.getByPlaceholder('e.g. Nightshade').fill(name);
  await page.getByRole('button', { name: 'Join room' }).click();
  await page.waitForURL(new RegExp(`/room/${code}$`), { timeout: 15_000 });
}

async function readRole(page: Page): Promise<string> {
  const el = page.getByTestId('role-label');
  await el.waitFor({ state: 'visible', timeout: 15_000 });
  return (await el.textContent())?.trim() ?? '';
}

test('four players play a full game to a Town win', async ({ browser }) => {
  const names = ['Alice', 'Bob', 'Cara', 'Dan'];
  const host = await newPlayer(browser);
  const code = await createRoom(host, names[0]);

  const others: Page[] = [];
  for (let i = 1; i < names.length; i++) {
    const p = await newPlayer(browser);
    await joinRoom(p, code, names[i]);
    others.push(p);
  }
  const pages = [host, ...others];
  const pageByName = new Map(names.map((n, i) => [n, pages[i]]));

  // Everyone non-host readies up, host starts.
  for (const p of others) {
    await p.getByRole('button', { name: "I'm ready" }).click();
  }
  const startBtn = host.getByRole('button', { name: 'Start game' });
  await expect(startBtn).toBeEnabled({ timeout: 10_000 });
  await startBtn.click();

  // Each player sees their private role; collect the mapping.
  const roleByName = new Map<string, string>();
  for (const name of names) {
    const role = await readRole(pageByName.get(name)!);
    roleByName.set(name, role);
  }
  // Exactly one Mafia and one Detective at 4 players (no doctor).
  const mafiaName = names.find((n) => roleByName.get(n) === 'Mafia')!;
  const detectiveName = names.find((n) => roleByName.get(n) === 'Detective')!;
  expect(mafiaName).toBeTruthy();
  expect(detectiveName).toBeTruthy();

  const townName = names.find(
    (n) => n !== mafiaName && n !== detectiveName,
  )!;

  // Wait for Night phase on the mafia's screen.
  const mafiaPage = pageByName.get(mafiaName)!;
  await expect(mafiaPage.getByTestId('phase-label')).toHaveText('Night', {
    timeout: 15_000,
  });

  // Mafia eliminates a townsperson.
  await mafiaPage.getByTestId(`player-${townName}`).click();
  await mafiaPage.getByRole('button', { name: 'Confirm action' }).click();

  // Detective investigates the mafia.
  const detPage = pageByName.get(detectiveName)!;
  await expect(detPage.getByTestId('phase-label')).toHaveText('Night', {
    timeout: 15_000,
  });
  await detPage.getByTestId(`player-${mafiaName}`).click();
  await detPage.getByRole('button', { name: 'Confirm action' }).click();

  // Detective privately learns the mafia identity.
  await expect(
    detPage.getByText('Investigation findings'),
  ).toBeVisible({ timeout: 15_000 });
  // The findings list shows an uppercase MAFIA verdict and names the mafia.
  await expect(
    detPage.getByText('MAFIA', { exact: true }),
  ).toBeVisible();
  await expect(
    detPage.getByText(`Night 1:`, { exact: false }),
  ).toContainText(mafiaName);

  // The town victim's screen should show them eliminated.
  const townPage = pageByName.get(townName)!;
  await expect(
    townPage.getByText('You have been eliminated', { exact: false }),
  ).toBeVisible({ timeout: 15_000 });

  // Proceed to Voting (day is short). The 3 living players vote out the mafia.
  const living = names.filter((n) => n !== townName);
  for (const name of living) {
    const pg = pageByName.get(name)!;
    await expect(pg.getByTestId('phase-label')).toHaveText('Voting', {
      timeout: 20_000,
    });
    await pg.getByTestId(`player-${mafiaName}`).click();
    await pg.getByRole('button', { name: 'Confirm vote' }).click();
  }

  // Town wins -> results screen on every page.
  for (const name of names) {
    const pg = pageByName.get(name)!;
    await expect(pg.getByText('Town Wins')).toBeVisible({ timeout: 20_000 });
    // Full role reveal is shown.
    await expect(pg.getByText('Final roles')).toBeVisible();
  }

  // Host can start a rematch, returning everyone to the lobby.
  await host.getByRole('button', { name: 'Play again' }).click();
  await expect(host.getByRole('button', { name: "I'm ready" })).toBeVisible({
    timeout: 15_000,
  });

  for (const p of pages) await p.context().close();
});
