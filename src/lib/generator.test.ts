import { describe, expect, it } from 'vitest'
import { createSampleRecording } from '../data/sampleRecording'
import { generateProject } from './generator'
import { parseRecording } from './recorder'

describe('generateProject', () => {
  const recording = parseRecording(createSampleRecording())
  const project = generateProject(recording)

  it('creates an executable Playwright project with a Page Object', () => {
    expect(project.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'tests/checkout-clearance.spec.ts',
        'pages/checkout-clearance.page.ts',
        'playwright.config.ts',
        'package.json',
      ]),
    )

    const pageObject = project.files.find((file) => file.path.includes('.page.ts'))?.content
    expect(pageObject).toContain("getByRole('button', { name: 'Add Trail Camera to cart'")
    expect(pageObject).toContain("locator('#checkout-email')")
  })

  it('references protected data through the environment', () => {
    const output = project.files.map((file) => file.content).join('\n')

    expect(output).toContain('process.env.TESTPILOT_SECRET')
    expect(output).not.toContain('portfolio-demo')
  })

  it('applies the selected artifact profile', () => {
    const configuredProject = generateProject(recording, {
      trace: false,
      screenshot: true,
      video: true,
    })
    const config = configuredProject.files.find((file) => file.path === 'playwright.config.ts')?.content

    expect(config).toContain("trace: 'off'")
    expect(config).toContain("screenshot: 'only-on-failure'")
    expect(config).toContain("video: 'retain-on-failure'")
    expect(config).toContain('timeout: 180000')
    expect(config).toContain('actionTimeout: 90000')
    expect(config).toContain('navigationTimeout: 90000')
  })

  it('supports bounded timeout overrides for agent attempts', () => {
    const configuredProject = generateProject(recording, {
      trace: true,
      screenshot: true,
      video: false,
      testTimeoutMs: 12_000,
      expectTimeoutMs: 6_000,
      actionTimeoutMs: 6_000,
      navigationTimeoutMs: 8_000,
    })
    const config = configuredProject.files.find((file) => file.path === 'playwright.config.ts')?.content

    expect(config).toContain('timeout: 12000')
    expect(config).toContain('expect: { timeout: 6000 }')
    expect(config).toContain('actionTimeout: 6000')
    expect(config).toContain('navigationTimeout: 8000')
  })

  it('sets dropdowns and event-sensitive inputs through their native interaction paths', () => {
    const recorderFlow = parseRecording({
      title: 'CROAMIS profile',
      steps: [
        { type: 'navigate', url: 'https://example.test/userHome' },
        { type: 'change', value: 'INT', selectors: [['#environment']] },
        { type: 'keyDown', key: 'Tab' },
      ],
    })
    const generated = generateProject(recorderFlow)
    const pageObject = generated.files.find((file) => file.path.includes('.page.ts'))?.content

    expect(pageObject).toContain("tagName === 'SELECT'")
    expect(pageObject).toContain('selectOption({ label: value })')
    expect(pageObject).toContain('pressSequentially(value, { delay: 80 })')
    expect(pageObject).toContain("keyboard.press('Tab', { delay: 80 })")
    expect(pageObject).toContain('waitForTimeout(350)')
  })
})