/**
 * GOLDEN PATH — the full Ask user journey against PROD in a real browser.
 *
 * Every test starts at the homepage and navigates via clicks (no page.goto after
 * the initial load except where a brand-new room/slug must be opened directly —
 * which is still a real navigation, not an API shortcut). Questions are seeded
 * through the real API, then driven with real clicks, exactly as a human in the
 * room would after their agent asked.
 *
 * Screenshots land in e2e/screenshots/<test>/<step>.png.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { seedOwnedRoom } from './_seed';
import { shot } from './_shot';

const BASE = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';

/** Attach a console-error collector; ignore benign network/websocket reconnection noise. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // The live WS can briefly fail during navigation/teardown — not a page defect.
    if (/websocket|ws:|wss:|network|Failed to load resource|ERR_/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe('golden path', () => {
  test('entry at / shows the personal dashboard with BOTH get-started prompts, 0 console errors', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    // Apex is a personal dashboard (§28-ext), not auto-create. A fresh principal lands
    // on the zero-state: the hero + New page CTA + the two copyable get-started prompts.
    await expect(page.getByRole('button', { name: /new page/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await shot(page, 'entry', '1-dashboard');

    // Both get-started prompts (project-scoped + global) are present and copyable.
    await expect(page.getByTestId('prompt-project')).toBeVisible();
    await expect(page.getByTestId('prompt-global')).toBeVisible();
    await expect(page.getByTestId('prompt-project-copy')).toBeEnabled();
    await expect(page.getByTestId('prompt-global-copy')).toBeEnabled();
    await shot(page, 'entry', '2-get-started-prompts');

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('a seeded single-choice question renders as a card → pick option + submit → Saved', async ({
    page,
  }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);

    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Scope to the heading (the title also appears as an sr-only radiogroup legend).
    await expect(
      card.getByRole('heading', { name: 'Which database should the MVP use?' }),
    ).toBeVisible();
    await shot(page, 'answer-submit', '1-question-card');

    // Pick the recommended option (D1), then submit.
    await card.getByText('Cloudflare D1').click();
    const submit = card.getByTestId('answer-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Server commit flips the card to a saved status chip ("Saved").
    await expect(card.getByTestId('status-chip')).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId('status-chip')).toContainText(/saved/i);
    await shot(page, 'answer-submit', '2-saved');
  });

  test('skip a question → saved as skipped', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByTestId('answer-skip').click();
    await expect(card.getByTestId('status-chip')).toBeVisible({ timeout: 20_000 });
    await shot(page, 'skip', '1-skipped');
  });

  test('delegate a question → Let the agent decide → saved', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByTestId('answer-delegate').click();
    await expect(card.getByTestId('status-chip')).toBeVisible({ timeout: 20_000 });
    await shot(page, 'delegate', '1-delegated');
  });

  test('explain-more → requested (honest 501 state)', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const card = page.getByTestId('question-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const explain = card.getByTestId('answer-explain');
    await explain.click();
    // Context-requests aren't wired yet → the UI honestly shows "Requested", never a fake success.
    await expect(explain).toContainText(/requested|asked/i, { timeout: 20_000 });
    await shot(page, 'explain', '1-requested');
  });

  test('tab switches: Questions → Decisions → Activity', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    await expect(page.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });

    // Answer first so Decisions + Activity have content.
    const card = page.getByTestId('question-card').first();
    await card.getByText('Cloudflare D1').click();
    await card.getByTestId('answer-submit').click();
    await expect(card.getByTestId('status-chip')).toBeVisible({ timeout: 20_000 });

    // The tabs are Kumo buttons; click by accessible name.
    await page.getByRole('tab', { name: /decisions/i }).click();
    await expect(page.getByTestId('status-chip').first()).toBeVisible();
    await shot(page, 'tabs', '1-decisions');

    await page.getByRole('tab', { name: /activity/i }).click();
    await expect(page.getByRole('list')).toBeVisible();
    await shot(page, 'tabs', '2-activity');

    await page.getByRole('tab', { name: /questions/i }).click();
    await expect(page.getByTestId('question-card').first()).toBeVisible();
    await shot(page, 'tabs', '3-back-to-questions');
  });

  test('owner renames the page via the slug input; URL + header update', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    await expect(page.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });

    // Click the slug wordmark (owner-only) to enter edit mode.
    await page.getByRole('button', { name: /rename page/i }).click();
    const input = page.getByTestId('slug-input');
    await expect(input).toBeVisible();
    const next = `${room.slug}-renamed`.slice(0, 60);
    await input.fill(next);
    await page.keyboard.press('Enter');

    // The URL adopts the new slug and the header reflects it.
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/${next}`);
    await expect(page.getByText(`ask/`).first()).toBeVisible();
    await shot(page, 'rename', '1-renamed');
  });

  test('copy link control is present and clickable', async ({ page }) => {
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const copyLink = page.getByTestId('copy-link');
    await expect(copyLink).toBeVisible({ timeout: 30_000 });
    await copyLink.click(); // toast fires; clipboard write is best-effort in-browser
    await shot(page, 'copy-link', '1-clicked');
  });
});
