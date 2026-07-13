import { defineConfig, devices } from '@playwright/test';

// Serve the app via Vite dev server during the test run. `base` in vite.config.js
// puts the app under /crosswalk-generator/, so baseURL includes that path.
const PORT = 5179;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/crosswalk-generator/`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/crosswalk-generator/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
