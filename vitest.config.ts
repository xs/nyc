import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/_tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'data'],
  },
});
