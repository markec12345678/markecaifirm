import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 10_000,
    // v8.93: SQLite is single-writer. With fileParallelism on (default),
    // DB-backed test files contend on the write lock and intermittently
    // time out in beforeAll hooks (flaky). Running files sequentially keeps
    // the suite deterministic. Tests are fast (I/O-bound, not CPU-bound) so
    // the wall-clock cost is minimal.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
