import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests wait for real queue round trips.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
