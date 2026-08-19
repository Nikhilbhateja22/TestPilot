import { z } from 'zod'

const commandSchema = z
  .object({
    type: z.string(),
    url: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    key: z.string().optional(),
    selectors: z.array(z.array(z.string())).optional(),
    target: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough()

const recordingSchema = z.object({
  title: z.string().trim().min(1).optional(),
  executionMode: z.enum(['live', 'demo']).default('demo'),
  steps: z.array(commandSchema).min(1, 'The recording does not contain any steps.'),
})

export type StepKind =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'press'
  | 'assert'
  | 'scroll'
  | 'viewport'
  | 'unsupported'

export type LocatorKind =
  | 'role'
  | 'label'
  | 'text'
  | 'test-id'
  | 'css'
  | 'xpath'
  | 'none'

export type LocatorCandidate = {
  kind: LocatorKind
  raw: string
  value: string
  role?: string
  score: number
}

export type NormalizedStep = {
  id: string
  index: number
  sourceType: string
  kind: StepKind
  title: string
  detail: string
  supported: boolean
  locator: LocatorCandidate
  alternatives: LocatorCandidate[]
  value?: string
  isSensitive: boolean
  url?: string
  key?: string
  coordinates?: { x: number; y: number }
  viewport?: { width: number; height: number }
}

export type ParsedRecording = {
  title: string
  executionMode: 'live' | 'demo'
  startUrl: string
  hostname: string
  steps: NormalizedStep[]
  supportedCount: number
  unsupportedCount: number
  averageLocatorScore: number
}

export class RecorderParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecorderParseError'
  }
}

const secretPattern = /password|passcode|secret|token|api[-_ ]?key|authorization/i

const toLocatorCandidate = (raw: string, sourceType: string): LocatorCandidate => {
  const ariaMatch = raw.match(/^aria\/(.+?)(?:\[role="([^"]+)"\])?$/)
  if (ariaMatch) {
    const [, value, role] = ariaMatch
    if (role) {
      const playwrightRole = role === 'image' ? 'img' : role
      return { kind: 'role', raw, value, role: playwrightRole, score: 98 }
    }

    return {
      kind: sourceType === 'change' ? 'label' : 'text',
      raw,
      value,
      score: sourceType === 'change' ? 94 : 84,
    }
  }

  if (raw.startsWith('text/')) {
    return { kind: 'text', raw, value: raw.slice(5), score: 82 }
  }

  const testIdMatch = raw.match(/\[data-testid=["']([^"']+)["']\]/)
  if (testIdMatch) {
    return { kind: 'test-id', raw, value: testIdMatch[1], score: 96 }
  }

  if (raw.startsWith('xpath/')) {
    return { kind: 'xpath', raw, value: raw.slice(6), score: 28 }
  }

  if (raw.startsWith('/') || raw.startsWith('(')) {
    return { kind: 'xpath', raw, value: raw, score: 24 }
  }

  const value = raw.startsWith('pierce/') ? raw.slice(7) : raw
  const isGeneratedId = /^#_[A-Za-z0-9_-]{16,}$/.test(value)
  const score = isGeneratedId ? 34 : /^#[\w-]+$/.test(value) ? 95 : value.includes(':nth-') ? 38 : 58
  return { kind: 'css', raw, value, score }
}

const selectLocators = (
  selectors: string[][] | undefined,
  sourceType: string,
): LocatorCandidate[] => {
  const flattened = selectors?.flat().filter(Boolean) ?? []
  return flattened
    .map((selector) => toLocatorCandidate(selector, sourceType))
    .sort((left, right) => right.score - left.score || left.value.length - right.value.length)
}

const emptyLocator = (): LocatorCandidate => ({
  kind: 'none',
  raw: '',
  value: '',
  score: 0,
})

const safeHostname = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return 'local recording'
  }
}

const describeTarget = (locator: LocatorCandidate): string => {
  if (locator.kind === 'none') return 'page'
  if (locator.kind === 'role') return locator.value
  if (locator.kind === 'css' || locator.kind === 'xpath') return locator.value
  return `“${locator.value}”`
}

const normalizeCommand = (
  command: z.infer<typeof commandSchema>,
  index: number,
): NormalizedStep | null => {
  if (command.type === 'keyUp') return null

  const alternatives = selectLocators(command.selectors, command.type)
  const locator = alternatives[0] ?? emptyLocator()
  const rawValue = command.value === undefined ? undefined : String(command.value)
  const isSensitive = secretPattern.test(`${locator.raw} ${locator.value}`)
  const value = isSensitive && rawValue ? '{{TESTPILOT_SECRET}}' : rawValue
  const base = {
    id: `step-${index + 1}`,
    index,
    sourceType: command.type,
    locator,
    alternatives,
    isSensitive,
  }

  switch (command.type) {
    case 'setViewport': {
      const width = command.width ?? 1440
      const height = command.height ?? 900
      return {
        ...base,
        kind: 'viewport',
        title: 'Set browser viewport',
        detail: `${width} × ${height}`,
        supported: true,
        viewport: { width, height },
      }
    }
    case 'navigate': {
      const url = command.url ?? ''
      return {
        ...base,
        kind: 'navigate',
        title: `Open ${safeHostname(url)}`,
        detail: url,
        supported: Boolean(url),
        url,
      }
    }
    case 'click':
      return {
        ...base,
        kind: 'click',
        title: `Click ${describeTarget(locator)}`,
        detail: locator.kind === 'none' ? 'A selector is required.' : `${locator.kind} locator`,
        supported: locator.kind !== 'none',
      }
    case 'change':
      return {
        ...base,
        kind: 'fill',
        title: `Enter value in ${describeTarget(locator)}`,
        detail: isSensitive ? 'Protected environment value' : (value ?? 'Empty value'),
        supported: locator.kind !== 'none',
        value,
      }
    case 'keyDown':
      return {
        ...base,
        kind: 'press',
        title: `Press ${command.key ?? 'key'}`,
        detail: locator.kind === 'none' ? 'Keyboard input on page' : `On ${describeTarget(locator)}`,
        supported: Boolean(command.key),
        key: command.key,
      }
    case 'waitForElement':
      return {
        ...base,
        kind: 'assert',
        title: `Verify ${describeTarget(locator)} is visible`,
        detail: 'Visibility assertion',
        supported: locator.kind !== 'none',
      }
    case 'scroll': {
      const x = command.x ?? 0
      const y = command.y ?? 0
      return {
        ...base,
        kind: 'scroll',
        title: 'Scroll the page',
        detail: `${x}px horizontal, ${y}px vertical`,
        supported: true,
        coordinates: { x, y },
      }
    }
    default:
      return {
        ...base,
        kind: 'unsupported',
        title: `Review ${command.type} command`,
        detail: 'This Recorder command needs manual conversion.',
        supported: false,
        value,
      }
  }
}

export const parseRecording = (input: unknown): ParsedRecording => {
  const result = recordingSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new RecorderParseError(issue?.message ?? 'This is not a valid Chrome Recorder file.')
  }

  const steps = result.data.steps
    .map(normalizeCommand)
    .filter((step): step is NormalizedStep => step !== null)
  const supportedCount = steps.filter((step) => step.supported).length
  const scoredLocators = steps
    .map((step) => step.locator.score)
    .filter((score) => score > 0)
  const averageLocatorScore = scoredLocators.length
    ? Math.round(scoredLocators.reduce((total, score) => total + score, 0) / scoredLocators.length)
    : 0
  const startUrl = steps.find((step) => step.kind === 'navigate')?.url ?? ''

  return {
    title: result.data.title ?? 'Untitled flight plan',
    executionMode: result.data.executionMode,
    startUrl,
    hostname: safeHostname(startUrl),
    steps,
    supportedCount,
    unsupportedCount: steps.length - supportedCount,
    averageLocatorScore,
  }
}