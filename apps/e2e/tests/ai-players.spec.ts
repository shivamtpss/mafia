import { test, expect, Browser, Page } from '@playwright/test';

/**
 * Phase 5 acceptance test: a single human host adds AI players to reach the
 * minimum, starts the game, and the match plays to completion driven almost
 * entirely by the server-side AI (night actions, votes, chatter). The human
 * host just abstains each phase. Verifies AI fill empty seats and a full game
 * reaches a result through the rendered UI.
 */

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test('host fills seats with AI and the game plays to a result', async ({
  browser,
}) => {
  const host = await newPlayer(browser);
  await host.goto('/play');
  await host.getByRole('button', { name: 'Create a room' }).click();
  await host.getByPlaceholder('e.g. Nightshade').fill('Captain');
  await host.getByRole('button', { name: 'Create room' }).click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}$/, { timeout: 15_000 });

  // Add 3 AI players to reach the 4-player minimum.
  const addBtn = host.getByRole('button', { name: '+ Add AI player' });
  for (let i = 0; i < 3; i++) {
    await addBtn.click();
    await host.waitForTimeout(150);
  }

  // The lobby should now show 3 bots and at least one AI badge.
  await expect(host.getByText('3 bots', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(host.getByText('AI', { exact: true }).first()).toBeVisible();

  // Start the game (AI are auto-ready, so the minimum is satisfied).
  const startBtn = host.getByRole('button', { name: 'Start game' });
  await expect(startBtn).toBeEnabled({ timeout: 10_000 });
  await startBtn.click();

  // The host reaches Role Reveal, then the phases advance on server timers.
  await expect(host.getByTestId('role-label')).toBeVisible({ timeout: 15_000 });

  // Abstain through the game: whenever a Confirm/Skip/Abstain control is shown,
  // the AI will carry the game; we just wait for the result. Poll for the
  // results screen within a generous bound (short phases via env in config).
  await expect(host.getByText(/Town Wins|Mafia Win/)).toBeVisible({
    timeout: 90_000,
  });
  // Full role reveal is shown at the end.
  await expect(host.getByText('Final roles')).toBeVisible();

  await host.context().close();
});
