import { defineConfig } from 'vite';

export default defineConfig({
  // Enable top-level await for potential WASM loading (Havok physics)
  esbuild: {
    target: 'es2022',
  },
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    // Exclude Babylon.js from pre-bundling for better compatibility
    exclude: ['@babylonjs/core'],
  },
});
