/**
 * Room-page setup prompts — the owner can copy BOTH get-started versions from the room
 * itself (not just the dashboard): "set up this project" (repo-scoped) and "add Ask to my
 * skills & CLAUDE.md" (global). Each names THIS room and is genuinely copyable.
 */
import { expect, test } from '@playwright/test';
import { seedOwnedRoom } from './_seed';
import { shot } from './_shot';

const BASE = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';

test.describe('room-page setup prompts', () => {
  test('room offers BOTH setup prompts (project + global), each copyable + room-specific', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);

    // The setup-prompts disclosure lives on the room page; ensure it is open.
    const toggle = page.getByTestId('setup-prompts-toggle');
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();

    const project = page.getByTestId('prompt-project');
    const globalCard = page.getByTestId('prompt-global');
    await expect(project).toBeVisible();
    await expect(globalCard).toBeVisible();
    // Distinct intents…
    await expect(project).toContainText(/this project|this repo/i);
    await expect(globalCard).toContainText(/skills|CLAUDE\.md|every project/i);
    // …and each prompt names THIS room's slug.
    await expect(project.locator('pre')).toContainText(room.slug);
    await expect(globalCard.locator('pre')).toContainText(room.slug);
    await shot(page, 'setup-prompts', '1-both-visible');

    // Both are genuinely copyable — project copy writes the project prompt…
    await page.getByTestId('prompt-project-copy').click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
      .toMatch(/set up ask for this project/i);
    // …and global copy writes the global prompt.
    await page.getByTestId('prompt-global-copy').click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
      .toMatch(/global agent config|every project/i);
    await shot(page, 'setup-prompts', '2-both-copied');
  });
});
