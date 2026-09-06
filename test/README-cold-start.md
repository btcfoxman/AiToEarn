# Test deployment and real browser acceptance

The default `push test` workflow runs the existing backend/web regression suites,
publishes and deploys the images, checks backend health, and checks that the
deployed application returns Next.js HTML. The last check is **not** browser
acceptance and is labelled accordingly in Actions.

Run the full browser acceptance from a workstation with access to the LAN. The
application remains on `192.168.3.6`; only the browser runs locally. The same
`cold-start-stability.spec.ts` verifies absent, valid and invalid plan IDs, ten
fresh contexts each, without model submissions or publication actions. Do not
replace it with a local fixture or reduce its assertions to make a release pass.

From the repository root in PowerShell, after installing the web project's locked
dependencies and ensuring local Chrome is available:

```powershell
$env:AITOEARN_E2E_BASE_URL = 'http://192.168.3.6:8081/zh-CN'
$env:AITOEARN_E2E_ATTEMPTS = '10'
$env:PLAYWRIGHT_CHANNEL = 'chrome' # use 'msedge' for installed Microsoft Edge
pnpm --dir project/aitoearn-web exec playwright test --config ../../test/cold-start/local.config.ts
```

Save the exit code, deployed image revision and test output in the release
acceptance record. Failure traces are under ignored `test-results/local-cold-start`.
An Actions success does not replace this separate browser result.

The test deployment also checks authenticated `HeadBucket` access using the
running application's `ASSETS_CONFIG`, independently of the optional administrator
bucket bootstrap. The current gate supports `s3` (also the application's default
when `provider` is omitted) with explicit business credentials. Other providers
need their own probe; `unsupported_provider` does not mean that provider is down.
Successful `HeadBucket` is not evidence of upload permission, CORS or anonymous
download access. No test object is written by this check.

The old server-side browser job remains available through the explicit
`workflow_dispatch` input `run_server_browser_regression=true`, for a suitably
resourced browser-capable host. It is off by default, including push deployments.
Do not enable it routinely on the current CentOS 7 / 3.10 kernel / approximately
4 GiB LAN application server. In run `34065489301`, deployment succeeded but
Chromium launch timed out before any page assertion, with concurrent service
probe delays. Its scoped container was removed and service readiness recovered.
This failure is not counted as a successful browser test.

Browser versions, system dependencies and Docker execution requirements are
documented in [Playwright's browser guide](https://playwright.dev/docs/browsers)
and [Docker guide](https://playwright.dev/docs/docker). Do not disable host-wide
security controls or restart shared infrastructure to force the optional job.
