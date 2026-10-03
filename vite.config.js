import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The editor at /, the launch site at /site/ (with its evidence, business and deck pages).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL('./index.html', import.meta.url)),
        site: fileURLToPath(new URL('./site/index.html', import.meta.url)),
        evidence: fileURLToPath(new URL('./site/evidence.html', import.meta.url)),
        business: fileURLToPath(new URL('./site/business.html', import.meta.url)),
        slides: fileURLToPath(new URL('./site/slides/index.html', import.meta.url)),
      },
    },
  },
});
