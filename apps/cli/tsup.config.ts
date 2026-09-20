import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
});
