/**
 * GOLDEN PATH (live + privacy + mobile) —
 *  - TWO browser contexts see a seeded question with NO reload (WebSocket live).
 *  - make-private is honest: billing isn't wired, so it stays public + says so.
 *  - mobile 375 one-question focus view works + no horizontal overflow.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiPublishQuestions, seedOwnedRoom, seedRoomWithQuestion, singleChoiceQuestion } from './_seed';
import { shot } from './_shot';

const BASE = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';


test.describe('live propagation (WebSocket)', () => {
  // FIXED 2026-10-02 (was a product bug; now a GREEN regression test).
  //
  // The "live, no reload" promise (Room.tsx docstring, §13) was broken for an
  // already-open browser: the Room DO emitted id-ONLY event payloads, but the
  // client's `applyEvent` needs the FULL entity, so nothing merged. Fix: the DO now
  // puts the full entity in every event payload (worker/room.ts append calls), so
  // the client's existing pullChanges → applyEvent path merges live. Verified on
  // prod: an open empty room showed 3 pushed questions with no reload.
  test('two contexts both see a newly-seeded question with no reload (live WS merge)', async ({
    browser,
    request,
  }) => {
    // Seed a room with one question so both viewers load a ready room.
    const room = await seedRoomWithQuestion(request, BASE, `ws-seed-${Date.now().toString(36)}`);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await pageA.goto(`${BASE}/${room.slug}`);
      await pageB.goto(`${BASE}/${room.slug}`);
      await expect(pageA.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });

      // Count current cards in both, then push a SECOND question via the API (as the agent).
      const beforeA = await pageA.getByTestId('question-card').count();
      await apiPublishQuestions(request, BASE, room.id, room.bearer, [
        { ...singleChoiceQuestion(`ws-live-${Date.now().toString(36)}`), title: 'Which cache layer should we use?' },
      ]);
      await shot(pageA, 'live-ws', '1-viewer-a');
      await shot(pageB, 'live-ws', '2-viewer-b');

      // THE CONTRACT (now GREEN): both open pages show the new question WITHOUT any reload.
      await expect(pageA.getByRole('heading', { name: 'Which cache layer should we use?' })).toBeVisible({ timeout: 20_000 });
      await expect(pageB.getByRole('heading', { name: 'Which cache layer should we use?' })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => pageA.getByTestId('question-card').count()).toBeGreaterThan(beforeA);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  // Companion positive test: the write + snapshot path works — the SAME new question
  // IS visible after an explicit reload. This proves the bug is purely in live-merge,
  // and gives a GREEN assertion that the WS/room write path itself is healthy.
  test('a newly-seeded question is visible after a reload (write + snapshot path works)', async ({
    page,
    request,
  }) => {
    const room = await seedRoomWithQuestion(request, BASE, `ws-reload-${Date.now().toString(36)}`);
    await page.goto(`${BASE}/${room.slug}`);
    await expect(page.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });
    const before = await page.getByTestId('question-card').count();

    await apiPublishQuestions(request, BASE, room.id, room.bearer, [
      { ...singleChoiceQuestion(`ws-reload-2-${Date.now().toString(36)}`), title: 'Which cache layer should we use?' },
    ]);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Which cache layer should we use?' })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.getByTestId('question-card').count()).toBeGreaterThan(before);
    await shot(page, 'live-ws', '3-after-reload');
  });
});

test.describe('make-private honesty', () => {
  test('owner "Make private" stays honest — public, billing-not-live note, nothing charged', async ({
    page,
  }) => {
    // make-private is owner-only → seed through the page's own context.
    const room = await seedOwnedRoom(page, BASE);
    await page.goto(`/${room.slug}`);
    const makePrivate = page.getByTestId('make-private');
    await expect(makePrivate).toBeVisible({ timeout: 30_000 });
    await makePrivate.click();

    // Honest 501 → an inline "coming soon" banner; the page badge stays Public.
    await expect(page.getByText(/coming soon|isn't live yet|stays public/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Public').first()).toBeVisible();
    await shot(page, 'make-private', '1-honest-public');
  });
});

test.describe('mobile focus view (375)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('375: one-question focus view toggles + no horizontal overflow', async ({ page }) => {
    // Seed TWO questions so the Focus toggle (shown only with >1) appears.
    const room = await seedOwnedRoom(page, BASE, `focus-${Date.now().toString(36)}`);
    await apiPublishQuestions(page.request, BASE, room.id, room.bearer, [
      { ...singleChoiceQuestion(`focus-2-${Date.now().toString(36)}`), title: 'Which deploy region?' },
    ]);

    await page.goto(`/${room.slug}`);
    await expect(page.getByTestId('question-card').first()).toBeVisible({ timeout: 30_000 });

    const focusToggle = page.getByTestId('focus-toggle');
    await expect(focusToggle).toBeVisible();
    await focusToggle.click();

    // Focus mode shows a single card + a "Question N of M" counter.
    await expect(page.getByText(/question \d+ of \d+/i)).toBeVisible();
    await expect(page.getByTestId('question-card')).toHaveCount(1);
    await shot(page, 'mobile-focus', '1-focus');

    // No horizontal overflow at 375.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
