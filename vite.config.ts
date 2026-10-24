import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: the app shell (index.html) and the iPhone test page (test/index.html).
// Output goes to dist/ and dist/test/. The service worker (dist/sw.js) is generated
// after the build by scripts/build-sw.mjs because it needs the final asset names.
export default defineConfig({
  base: '/pocket-brain/',
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        test: resolve(import.meta.dirname, 'test/index.html'),
      },
    },
  },
});
