import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsAssets } from './tools/pdfjs-assets.js';

export default defineConfig({ plugins: [react(), pdfjsAssets()] });
