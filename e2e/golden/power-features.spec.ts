/**
 * Power-user + polish features (the "30 ideas → top picks" release):
 *   ⭐#6  keyboard decision flow — number picks an option, Enter submits
 *   ⭐#26 shortcuts help overlay — `?` opens, Esc closes
 *   ⭐#11 draft autosave — a typed note survives a reload
 *   ⭐#21 copy micro-interaction — the Copy button flips to "Copied"
 *   ⭐#1  dashboard urgency — pages with open questions surface a "needs you" badge
 */
import { expect, test } from '@playwright/test';
import { seedOwnedRoom } from './_seed';
import { shot } from './_shot';

const BASE = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';

test.describe('power features', () => {
  test('⭐#6/#26 keyboard: number picks an option + Enter submits; ? opens shortcuts', async ({
    page,
  }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    // `?` opens the shortcuts overlay; Esc closes it.
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-overlay')).toBeVisible();
    await shot(page, 'power', '1-shortcuts');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-overlay')).toBeHidden();

    // Pick option 1 (Cloudflare D1) with the number key → submit enables.
    await page.keyboard.press('1');
    await expect(card.getByTestId('answer-submit')).toBeEnabled();
    // Enter submits the focused card → it flips to a saved status.
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('status-chip')).toContainText(/saved/i, { timeout: 20_000 });
    await shot(page, 'power', '2-keyboard-answered');
  });

  test('⭐#11 draft autosave — a typed note survives a reload', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    const note = card.getByPlaceholder('Add a note (optional)');
    await note.fill('leaning D1 for edge locality');
    await page.waitForTimeout(400); // let the persist effect write to localStorage
    await page.reload();

    const restored = page.getByTestId('question-card').first().getByPlaceholder('Add a note (optional)');
    await expect(restored).toHaveValue(/leaning D1 for edge locality/, { timeout: 30_000 });
    await shot(page, 'power', '3-draft-restored');
  });

  test('⭐#21 copy micro-interaction — Copy flips to "Copied"', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-write']);
    await page.goto('/');
    const copyBtn = page.getByTestId('prompt-project-copy');
    await expect(copyBtn).toBeVisible({ timeout: 30_000 });
    await copyBtn.click();
    await expect(copyBtn).toContainText(/copied/i);
    await shot(page, 'power', '4-copied');
  });

  test('⭐#1 dashboard surfaces pages that need you', async ({ page }) => {
    await seedOwnedRoom(page, BASE);
    await page.goto('/');
    // The owned room has an open question → the dashboard shows the "needs you" pulse.
    await expect(page.getByTestId('dashboard-needs-you')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('dashboard-room-card').first()).toBeVisible();
    await shot(page, 'power', '5-needs-you');
  });
});
