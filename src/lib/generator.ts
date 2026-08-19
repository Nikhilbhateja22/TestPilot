import type { LocatorCandidate, NormalizedStep, ParsedRecording } from './recorder'

export type GeneratedFile = {
  path: string
  language: 'typescript' | 'json' | 'markdown' | 'text'
  content: string
}

export type GeneratedProject = {
  name: string
  testName: string
  className: string
  files: GeneratedFile[]
  lineCount: number
}

export type GenerationOptions = {
  trace: boolean
  screenshot: boolean
  video: boolean
}

const defaultOptions: GenerationOptions = {
  trace: true,
  screenshot: true,
  video: false,
}

const quote = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`

const words = (value: string): string[] =>
  value
    .replace(/[“”"']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

const toPascalCase = (value: string, fallback: string): string => {
  const parts = words(value)
  const name = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join('')
  const safeName = name || fallback
  return /^\d/.test(safeName) ? `Flow${safeName}` : safeName
}

const toCamelCase = (value: string, fallback: string): string => {
  const pascal = toPascalCase(value, fallback)
  return pascal[0].toLowerCase() + pascal.slice(1)
}

const locatorExpression = (locator: LocatorCandidate): string => {
  switch (locator.kind) {
    case 'role':
      return `this.page.getByRole(${quote(locator.role ?? 'button')}, { name: ${quote(locator.value)}, exact: true })`
    case 'label':
      return `this.page.getByLabel(${quote(locator.value)}, { exact: true })`
    case 'text':
      return `this.page.getByText(${quote(locator.value)}, { exact: true })`
    case 'test-id':
      return `this.page.getByTestId(${quote(locator.value)})`
    case 'css':
    case 'xpath':
      return `this.page.locator(${quote(locator.value)})`
    case 'none':
      return `this.page.locator('body')`
  }
}

const needsLocator = (step: NormalizedStep): boolean =>
  ['click', 'fill', 'assert'].includes(step.kind) || (step.kind === 'press' && step.locator.kind !== 'none')

const locatorName = (step: NormalizedStep): string => {
  const source = step.locator.value || step.title
  return `${toCamelCase(source, 'target')}Target${String(step.index + 1).padStart(2, '0')}`
}

const methodName = (step: NormalizedStep): string =>
  `${toCamelCase(step.title, 'runStep')}Step${String(step.index + 1).padStart(2, '0')}`

const actionBody = (step: NormalizedStep): string[] => {
  const target = `this.${locatorName(step)}`
  switch (step.kind) {
    case 'viewport':
      return [
        `await this.page.setViewportSize({ width: ${step.viewport?.width ?? 1440}, height: ${step.viewport?.height ?? 900} })`,
      ]
    case 'navigate':
      return [`await this.page.goto(${quote(step.url ?? '/')})`]
    case 'click':
      return [`await ${target}.click()`]
    case 'fill': {
      if (step.isSensitive) {
        return [
          `const secret = process.env.TESTPILOT_SECRET`,
          `if (!secret) throw new Error('TESTPILOT_SECRET is required for this journey.')`,
          `await this.setRecordedValue(${target}, secret)`,
        ]
      }
      return [`await this.setRecordedValue(${target}, ${quote(step.value ?? '')})`]
    }
    case 'press': {
      const press = step.locator.kind === 'none'
        ? `await this.page.keyboard.press(${quote(step.key ?? 'Enter')}, { delay: 80 })`
        : `await ${target}.press(${quote(step.key ?? 'Enter')}, { delay: 80 })`
      return step.key === 'Tab' ? [press, `await this.page.waitForTimeout(350)`] : [press]
    }
    case 'assert':
      return [`await expect(${target}).toBeVisible()`]
    case 'scroll':
      return [
        `await this.page.mouse.wheel(${step.coordinates?.x ?? 0}, ${step.coordinates?.y ?? 0})`,
      ]
    case 'unsupported':
      return [`throw new Error(${quote(`Manual conversion required for ${step.sourceType}.`)})`]
  }
}

const createPageObject = (recording: ParsedRecording, className: string): string => {
  const locatorSteps = recording.steps.filter(needsLocator)
  const hasFillSteps = recording.steps.some((step) => step.kind === 'fill')
  const fields = locatorSteps.map((step) => `  readonly ${locatorName(step)}: Locator`).join('\n')
  const assignments = locatorSteps
    .map((step) => `    this.${locatorName(step)} = ${locatorExpression(step.locator)}`)
    .join('\n')
  const methods = recording.steps
    .map((step) => {
      const body = actionBody(step).map((line) => `    ${line}`).join('\n')
      return `  async ${methodName(step)}(): Promise<void> {\n${body}\n  }`
    })
    .join('\n\n')
  const valueHelper = hasFillSteps
    ? `  private async setRecordedValue(locator: Locator, value: string): Promise<void> {\n    const tagName = await locator.evaluate((element) => element.tagName)\n    if (tagName === 'SELECT') {\n      try {\n        await locator.selectOption({ label: value })\n      } catch {\n        await locator.selectOption(value)\n      }\n      return\n    }\n\n    await locator.click()\n    await locator.press('ControlOrMeta+A')\n    await locator.pressSequentially(value, { delay: 80 })\n  }\n\n`
    : ''

  return `import { expect, type Locator, type Page } from '@playwright/test'\n\nexport class ${className} {\n  readonly page: Page${fields ? `\n${fields}` : ''}\n\n  constructor(page: Page) {\n    this.page = page${assignments ? `\n${assignments}` : ''}\n  }\n\n${valueHelper}${methods}\n}\n`
}

const createTest = (recording: ParsedRecording, className: string, fileStem: string): string => {
  const steps = recording.steps
    .map(
      (step) =>
        `  await test.step(${quote(step.title)}, async () => {\n    await journey.${methodName(step)}()\n  })`,
    )
    .join('\n\n')

  return `import { test } from '@playwright/test'\nimport { ${className} } from '../pages/${fileStem}.page'\n\ntest(${quote(recording.title)}, async ({ page }) => {\n  const journey = new ${className}(page)\n\n${steps}\n})\n`
}

const createConfig = (options: GenerationOptions): string => `import { defineConfig, devices } from '@playwright/test'\n\nexport default defineConfig({\n  testDir: './tests',\n  outputDir: './test-results/artifacts',\n  timeout: 180_000,\n  expect: { timeout: 90_000 },\n  retries: 0,\n  reporter: [\n    ['line'],\n    ['json', { outputFile: 'test-results/results.json' }],\n  ],\n  use: {\n    actionTimeout: 90_000,\n    navigationTimeout: 90_000,\n    trace: '${options.trace ? 'retain-on-failure' : 'off'}',\n    screenshot: '${options.screenshot ? 'only-on-failure' : 'off'}',\n    video: '${options.video ? 'retain-on-failure' : 'off'}',\n  },\n  projects: [\n    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },\n  ],\n})\n`

const createPackageJson = (projectName: string): string =>
  `${JSON.stringify(
    {
      name: projectName,
      private: true,
      version: '1.0.0',
      scripts: { test: 'playwright test', 'test:headed': 'playwright test --headed' },
      devDependencies: { '@playwright/test': '^1.62.0', typescript: '^5.8.0' },
    },
    null,
    2,
  )}\n`

const createReadme = (recording: ParsedRecording): string =>
  [
    `# ${recording.title}`,
    '',
    'Generated by TestPilot from a Chrome Recorder journey.',
    '',
    '## Run',
    '',
    '```bash',
    'npm install',
    'npx playwright install chromium',
    'npm test',
    '```',
    '',
    'Copy `.env.example` to `.env` and provide any protected values before running.',
    '',
  ].join('\n')

export const generateProject = (
  recording: ParsedRecording,
  options: GenerationOptions = defaultOptions,
): GeneratedProject => {
  const className = `${toPascalCase(recording.title, 'Recorded')}Journey`
  const fileStem = words(recording.title).map((part) => part.toLowerCase()).join('-') || 'recorded-journey'
  const projectName = `testpilot-${fileStem}`
  const files: GeneratedFile[] = [
    {
      path: `tests/${fileStem}.spec.ts`,
      language: 'typescript',
      content: createTest(recording, className, fileStem),
    },
    {
      path: `pages/${fileStem}.page.ts`,
      language: 'typescript',
      content: createPageObject(recording, className),
    },
    {
      path: 'playwright.config.ts',
      language: 'typescript',
      content: createConfig(options),
    },
    {
      path: 'package.json',
      language: 'json',
      content: createPackageJson(projectName),
    },
    {
      path: '.env.example',
      language: 'text',
      content: 'TESTPILOT_SECRET=replace-me\n',
    },
    {
      path: 'README.md',
      language: 'markdown',
      content: createReadme(recording),
    },
  ]

  return {
    name: projectName,
    testName: recording.title,
    className,
    lineCount: files.reduce((total, file) => total + file.content.split('\n').length, 0),
    files,
  }
}