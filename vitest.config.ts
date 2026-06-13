import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup-git-env.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // A handful of tests touch real filesystem timing (fs watchers, mtime-based
    // staleness, debounce) and go flaky under full-suite parallel contention on
    // Windows — intermittently blocking the prepublishOnly gate. Retry re-runs
    // ONLY the failed test: a timing flake passes on a second attempt, while a
    // genuinely broken test fails all attempts and is still caught.
    retry: 2,
  },
});
