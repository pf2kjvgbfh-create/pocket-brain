import { defineConfig, devices } from '@playwright/test';

// BASE_URL set → test that deployed site (e.g. the live Pages URL); otherwise build output via `vite preview`.
const live = process.env.BASE_URL;
const baseURL = live ?? 'http://localhost:4173/pocket-brain/';
const phone = { width: 375, height: 812 };

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  outputDir: 'test-results/artifacts',
  use: { baseURL, serviceWorkers: 'allow' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: phone } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: phone } },
    { name: 'chromium-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-1280', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
    // The owner's phone as close as the laptop gets: WebKit, an iPhone (touch, mobile Safari UA), 375 px, a device in New York
    // (so every «у тебя …» local-time line shows), Russian locale. Stage 7 UX walk-through: e2e/ux.spec.ts.
    {
      name: 'iphone-ny',
      use: { ...devices['iPhone 17 Pro Max'], viewport: phone, timezoneId: 'America/New_York', locale: 'ru-RU' },
    },
  ],
  webServer: live
    ? undefined
    : { command: 'pnpm preview', url: 'http://localhost:4173/pocket-brain/', reuseExistingServer: true },
});
