// Shared e2e helpers. The shortcuts:// scheme is never really opened: a click listener added by the TEST
// (addInitScript, not part of the app) cancels the default action and records every click on such a link.
// Production code has no hook for this.
import type { Page } from '@playwright/test';

export interface ShortcutClick {
  href: string;
  /** true for the page's own automatic open (data-action="remind-auto"), false for the «Поставить напоминание» button. */
  auto: boolean;
}

declare global {
  interface Window {
    __shortcutClicks?: ShortcutClick[];
  }
}

/** The undo window of the toast (UNDO_MS in src/config.ts). */
export const UNDO_MS = 5000;

export async function captureShortcutClicks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__shortcutClicks = [];
    window.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest('a[href^="shortcuts:"]');
      if (!a) return;
      e.preventDefault();
      window.__shortcutClicks?.push({ href: a.getAttribute('href') ?? '', auto: a.getAttribute('data-action') === 'remind-auto' });
    });
  });
}

export const shortcutClicks = (page: Page): Promise<ShortcutClick[]> => page.evaluate(() => window.__shortcutClicks ?? []);

/** Let the undo window pass (plus a margin) so a wrongly scheduled automatic open would have happened by now. */
export const waitPastUndo = (page: Page): Promise<void> => page.waitForTimeout(UNDO_MS + 1500);
