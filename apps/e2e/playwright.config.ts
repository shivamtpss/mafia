import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Boots the NestJS server and the production Next.js build, then
 * drives real browser contexts against the rendered UI — the true end-user
 * acceptance path.
 *
 * Note: NEXT_PUBLIC_SERVER_URL is inlined into the web bundle at build time
 * (baked as http://localhost:4000), so the backend here must listen on 4000.
 * The web app is served on a dedicated test port and CORS is opened for it.
 */
const WEB_PORT = 3100;
const SERVER_PORT = 4000;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node ../server/dist/main.js`,
      cwd: __dirname,
      env: {
        SERVER_PORT: String(SERVER_PORT),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        NODE_ENV: 'production',
        // Short phases so the full-game e2e runs quickly and deterministically.
        AI_MAFIA_PHASE_ROLE_REVEAL: '2',
        AI_MAFIA_PHASE_NIGHT: '12',
        AI_MAFIA_PHASE_DAY: '2',
        AI_MAFIA_PHASE_VOTING: '12',
        AI_MAFIA_PHASE_ELIMINATION: '2',
      },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Standalone output requires running server.js (not `next start`). We copy
      // static assets into the standalone tree first (mirrors the Dockerfile).
      command:
        `bash -c "cp -r ../web/.next/static ../web/.next/standalone/apps/web/.next/static 2>/dev/null; ` +
        `cp -r ../web/public ../web/.next/standalone/apps/web/public 2>/dev/null; ` +
        `PORT=${WEB_PORT} HOSTNAME=127.0.0.1 node ../web/.next/standalone/apps/web/server.js"`,
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
