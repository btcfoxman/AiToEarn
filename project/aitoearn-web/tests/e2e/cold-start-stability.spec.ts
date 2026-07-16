import { expect, test } from '@playwright/test'

const baseURL = process.env.AITOEARN_E2E_BASE_URL

test.describe('cold browser startup', () => {
  test.skip(!baseURL, 'Set AITOEARN_E2E_BASE_URL after deploying the test environment')

  test('does not enter the Next.js client error page', async ({ browser }) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const reactErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('React error #185'))
          reactErrors.push(message.text())
      })

      await page.goto(baseURL!, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)

      await expect(page.getByText('Application error', { exact: false })).toHaveCount(0)
      expect(reactErrors).toEqual([])
      await context.close()
    }
  })
})
