import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Devvit server code (and these tests) run in Node, not a browser.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The @devvit/test harness boots an in-memory Redis on first import, which
    // can take a moment; keep a generous ceiling so cold starts don't flake.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server/index.ts', 'src/server/markdown.d.ts', 'src/shared/types.ts'],
    },
  },
});
