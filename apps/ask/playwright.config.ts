/**
 * Playwright config for the Ask golden-path E2E suite.
 *
 * Drives a REAL Chromium browser against the live PROD deployment (no mocks):
 * the suite starts at the homepage, navigates via clicks, and seeds questions
 * through the real API (request.post) exactly as a coding agent would.
 *
 * Six viewport projects (375/390/768/1024/1280/1920) all run `chromium`.
 * Override the base URL with PROD_URL.
 */
import { defineConfig, devices } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://ask-megabyte-space.manhattan.workers.dev';

const viewports = [
  { name: 'chromium-375', width: 375, height: 812 },
  { name: 'chromium-390', width: 390, height: 844 },
  { name: 'chromium-768', width: 768, height: 1024 },
  { name: 'chromium-1024', width: 1024, height: 768 },
  { name: 'chromium-1280', width: 1280, height: 800 },
  { name: 'chromium-1920', width: 1920, height: 1080 },
];

export default defineConfig({
  testDir: '../../e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: PROD_URL,
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Realistic desktop Chrome UA so the Worker/WAF never challenges the run.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  },
  projects: viewports.map((v) => ({
    name: v.name,
    use: { ...devices['Desktop Chrome'], viewport: { width: v.width, height: v.height } },
  })),
});
