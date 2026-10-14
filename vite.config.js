import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsAssets } from './tools/pdfjs-assets.js';

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  clearScreen: false,
  build: { target: 'chrome80' },
  worker: { format: 'es' },
  server: { watch: { ignored: ['**/src-tauri/**'] } },
});
