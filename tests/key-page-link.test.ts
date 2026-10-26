import { describe, expect, it } from 'vitest';
import { TOKEN_PAGE_PREFIX, TOKEN_PAGE_URL } from '../src/config';

describe('the GitHub «new access key» link in Settings', () => {
  it('is pre-filled for the private copy repository, one year, write access', () => {
    expect(TOKEN_PAGE_URL).toBe(
      'https://github.com/settings/personal-access-tokens/new?name=pocket-brain&description=Backup%20for%20pocket-brain-data&target_name=pf2kjvgbfh-create&expires_in=366&contents=write',
    );
    expect(TOKEN_PAGE_URL.startsWith(`${TOKEN_PAGE_PREFIX}?`)).toBe(true);
  });
});
