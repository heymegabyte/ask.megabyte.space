/**
 * Screenshot helper — anchors output to the repo-root `e2e/screenshots/` dir
 * regardless of the process cwd (Playwright runs from apps/ask, but screenshots
 * must land at the repo-root e2e/ per the suite layout).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// This file lives at <repo>/e2e/golden/_shot.ts → '..' is <repo>/e2e.
const E2E_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Capture a full-page screenshot to e2e/screenshots/<name>/<step>.png. */
export function shot(page: Page, name: string, step: string): Promise<Buffer> {
  return page.screenshot({ path: resolve(E2E_DIR, 'screenshots', name, `${step}.png`), fullPage: true });
}
