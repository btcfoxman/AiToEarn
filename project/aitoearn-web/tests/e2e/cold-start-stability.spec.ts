import { expect, test, type Browser, type Page } from '@playwright/test'

const baseURL = process.env.AITOEARN_E2E_BASE_URL
const attempts = parsePositiveInteger(process.env.AITOEARN_E2E_ATTEMPTS, 5)
const readyTimeoutMs = 45_000
const stabilityWindowMs = 5_000
const invalidPlanId = 'invalid-cold-start-plan-id'

type Scenario = 'valid planId' | 'no planId' | 'invalid planId'

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function buildScenarioURL(planId?: string) {
  const url = new URL(baseURL!)
  if (planId) url.searchParams.set('planId', planId)
  else url.searchParams.delete('planId')
  return url.toString()
}

function isMaximumUpdateError(message: string) {
  return /React error #185|Maximum update depth exceeded/i.test(message)
}

async function expectDraftBoxReady(page: Page) {
  await expect(page.getByTestId('draftbox-plan-tabs')).toBeVisible({ timeout: readyTimeoutMs })
  await expect(page.getByTestId('draftbox-ai-submit-btn')).toBeVisible({ timeout: readyTimeoutMs })
  await expect
    .poll(() => new URL(page.url()).searchParams.get('planId'), {
      message: 'DraftBox should resolve the active plan into the URL',
      timeout: readyTimeoutMs,
    })
    .not.toBeNull()
}

async function verifyColdStart(
  browser: Browser,
  scenario: Scenario,
  attempt: number,
  url: string,
  expectedPlanId?: string
) {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const runtimeErrors: string[] = []
  const label = `${scenario}, attempt ${attempt}/${attempts}`

  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' && isMaximumUpdateError(text))
      runtimeErrors.push(`console: ${text}`)
  })
  page.on('pageerror', (error) => {
    runtimeErrors.push(`pageerror: ${error.message}`)
  })
  page.on('crash', () => {
    runtimeErrors.push('page crash: the browser page terminated unexpectedly')
  })

  try {
    const response = await page.goto(url, {
      timeout: readyTimeoutMs,
      waitUntil: 'domcontentloaded',
    })
    expect(response?.ok(), `${label} should return a successful document response`).toBe(true)

    await expectDraftBoxReady(page)
    const resolvedPlanId = new URL(page.url()).searchParams.get('planId')
    expect(resolvedPlanId, `${label} should resolve a planId`).toBeTruthy()
    if (expectedPlanId)
      expect(resolvedPlanId, `${label} should preserve the expected planId`).toBe(expectedPlanId)

    await page.waitForTimeout(stabilityWindowMs)
    await expectDraftBoxReady(page)
    const stablePlanId = new URL(page.url()).searchParams.get('planId')
    expect(stablePlanId, `${label} should keep the same planId during the stability window`).toBe(
      resolvedPlanId
    )
    await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
    expect(runtimeErrors, `${label} should not report fatal browser errors`).toEqual([])

    return resolvedPlanId!
  } catch (error) {
    if (runtimeErrors.length > 0) {
      const originalMessage = error instanceof Error ? `\nOriginal failure: ${error.message}` : ''
      throw new Error(
        `${label} reported fatal browser errors:\n${runtimeErrors.join('\n')}${originalMessage}`
      )
    }
    throw error
  } finally {
    await context.close()
  }
}

test.describe('cold browser startup', () => {
  test.skip(!baseURL, 'Set AITOEARN_E2E_BASE_URL after deploying the test environment')

  test('keeps the DraftBox stable with valid, absent, and invalid planId values', async ({
    browser,
  }) => {
    test.setTimeout(attempts * 3 * (readyTimeoutMs + stabilityWindowMs) + 60_000)

    let validPlanId: string | undefined
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const resolvedPlanId = await verifyColdStart(
        browser,
        'no planId',
        attempt,
        buildScenarioURL(),
        validPlanId
      )
      validPlanId ||= resolvedPlanId
    }
    const expectedValidPlanId = validPlanId!

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await verifyColdStart(
        browser,
        'valid planId',
        attempt,
        buildScenarioURL(expectedValidPlanId),
        expectedValidPlanId
      )
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const resolvedPlanId = await verifyColdStart(
        browser,
        'invalid planId',
        attempt,
        buildScenarioURL(invalidPlanId),
        expectedValidPlanId
      )
      expect(resolvedPlanId, 'An invalid planId should be replaced with a valid plan').not.toBe(
        invalidPlanId
      )
    }
  })
})
