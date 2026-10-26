import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: the app shell (index.html), the iPhone test page (test/index.html) and the Shortcut install
// page (install/index.html). Output goes to dist/, dist/test/ and dist/install/. The service worker (dist/sw.js) is generated
// after the build by scripts/build-sw.mjs because it needs the final asset names.
export default defineConfig({
  base: '/pocket-brain/',
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        test: resolve(import.meta.dirname, 'test/index.html'),
        install: resolve(import.meta.dirname, 'install/index.html'),
      },
    },
  },
});
