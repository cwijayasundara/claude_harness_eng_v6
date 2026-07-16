/**
 * Vitest config template (boundary-test-doubles kit, gap G34). The scaffold ships no vitest
 * config today; copy this to the project root as vitest.config.ts and adapt. Wires the
 * boundary-doubles setup file and a jsdom environment for React component tests.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
    // Point at the copied kit setup (adjust the path to where you place it in the project).
    setupFiles: ['./tests/boundary-doubles/vitest.setup.ts'],
  },
});
