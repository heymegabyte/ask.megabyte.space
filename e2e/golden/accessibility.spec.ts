/**
 * GOLDEN PATH (accessibility) — axe-core 0 serious/critical violations across the
 * three tabs (Questions / Decisions / Activity) at 375 and 1280.
 *
 * A seeded + answered question gives every tab real content to audit.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { seedOwnedRoom } from './_seed';
import { shot } from './_shot';

const BASE = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';


/** Run axe, filter to serious+critical, and return a readable violation list. */
async function seriousCritical(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`);
}

for (const width of [375, 1280]) {
  test.describe(`axe @ ${width}`, () => {
    test.use({ viewport: { width, height: width < 500 ? 812 : 800 } });

    test(`0 serious/critical across Questions · Decisions · Activity @ ${width}`, async ({ page }) => {
      const room = await seedOwnedRoom(page, BASE);
      await page.goto(`/${room.slug}`);
      const card = page.getByTestId('question-card').first();
      await expect(card).toBeVisible({ timeout: 30_000 });

      // Answer so Decisions + Activity have content to audit.
      await card.getByText('Cloudflare D1').click();
      await card.getByTestId('answer-submit').click();
      await expect(card.getByTestId('status-chip')).toBeVisible({ timeout: 20_000 });

      // Questions tab.
      let v = await seriousCritical(page);
      await shot(page, `axe-${width}`, '1-questions');
      expect(v, `Questions: ${v.join(' | ')}`).toHaveLength(0);

      // Decisions tab.
      await page.getByRole('tab', { name: /decisions/i }).click();
      await expect(page.getByTestId('status-chip').first()).toBeVisible();
      v = await seriousCritical(page);
      await shot(page, `axe-${width}`, '2-decisions');
      expect(v, `Decisions: ${v.join(' | ')}`).toHaveLength(0);

      // Activity tab.
      await page.getByRole('tab', { name: /activity/i }).click();
      await expect(page.getByRole('list')).toBeVisible();
      v = await seriousCritical(page);
      await shot(page, `axe-${width}`, '3-activity');
      expect(v, `Activity: ${v.join(' | ')}`).toHaveLength(0);
    });
  });
}
