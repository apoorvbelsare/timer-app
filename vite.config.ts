import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

// Tauri expects a fixed port and loads each window from its own page
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2021',
    rollupOptions: {
      input: { widget: page('widget'), planner: page('planner'), overlay: page('overlay'), focus: page('focus'), capture: page('capture') },
    },
  },
});
