import { defineConfig } from 'vitest/config';

// Unit tests run in Node: the sim, serializers and exporters have no DOM dependency.
// Kept separate from vite.config.ts so the React and Tailwind plugins stay out of test runs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/*.test.ts'],
    // A Node process per worker; four keep a local run light without slowing it much
    maxWorkers: process.env.CI ? undefined : 4,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**'],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
