import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The editor at /, the launch site at /site/ (with its presentation deck).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL('./index.html', import.meta.url)),
        site: fileURLToPath(new URL('./site/index.html', import.meta.url)),
        slides: fileURLToPath(new URL('./site/slides/index.html', import.meta.url)),
      },
    },
  },
});
