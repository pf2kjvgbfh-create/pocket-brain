import base from '../playwright.config';
import { defineConfig } from '@playwright/test';

// Manual heavy checks (model downloads): pnpm exec playwright test -c e2e-manual/manual.config.ts
export default defineConfig({ ...base, testDir: '.', outputDir: '../test-results/manual' });
