import { defineConfig } from 'vitest/config';

// One runner for the whole repo, split by where the code runs. Each test file
// runs in its own process (like node --test did), so server tests that point
// DB_PATH at a fresh database never share one.
export default defineConfig({
  test: {
    pool: 'forks',
    // node:sqlite still prints an ExperimentalWarning in every test process.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
          // Points the database at a throwaway file before server/db.ts opens it.
          setupFiles: ['server/test/env.ts'],
        },
      },
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['scripts/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        // React components, built with the app's own Vite config (JSX, aliases).
        extends: './vite.config.ts',
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
    coverage: {
      include: ['server/**', 'shared/**', 'src/**', 'scripts/**'],
      exclude: ['**/*.test.*', '**/test/**'],
    },
  },
});
