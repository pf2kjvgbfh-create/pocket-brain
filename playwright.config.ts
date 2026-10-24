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
  ],
  webServer: live
    ? undefined
    : { command: 'pnpm preview', url: 'http://localhost:4173/pocket-brain/', reuseExistingServer: true },
});
