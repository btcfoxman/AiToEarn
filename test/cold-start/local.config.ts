// Keep browser processes off the small LAN application server. This runs the
// unchanged production-page regression, not a local app or response fixture.
process.env.AITOEARN_E2E_ATTEMPTS ||= '10'

export default {
  testDir: '../../project/aitoearn-web/tests/e2e',
  testMatch: 'cold-start-stability.spec.ts',
  workers: 1,
  retries: 0,
  outputDir: '../../test-results/local-cold-start',
  reporter: 'line',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    launchOptions: { timeout: 30_000 },
    trace: 'retain-on-failure',
  },
}
