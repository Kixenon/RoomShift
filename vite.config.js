import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The editor at /, the launch site at /site/ (with its science, pricing, vision and deck pages).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        editor: fileURLToPath(new URL('./index.html', import.meta.url)),
        site: fileURLToPath(new URL('./site/index.html', import.meta.url)),
        science: fileURLToPath(new URL('./site/science.html', import.meta.url)),
        pricing: fileURLToPath(new URL('./site/pricing.html', import.meta.url)),
        design: fileURLToPath(new URL('./site/design.html', import.meta.url)),
        vision: fileURLToPath(new URL('./site/vision.html', import.meta.url)),
        slides: fileURLToPath(new URL('./site/slides/index.html', import.meta.url)),
      },
    },
  },
});
