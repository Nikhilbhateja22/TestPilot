import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { generateProject } from '../src/lib/generator'
import type { GenerationOptions } from '../src/lib/generator'
import type { ParsedRecording } from '../src/lib/recorder'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
export const runsDirectory = path.join(projectRoot, '.testpilot-runs')
const playwrightCli = path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const outputLimit = 120_000

type ProcessResult = {
  exitCode: number
  output: string
  timedOut: boolean
}

export type JourneyRunResult = {
  id: string
  status: 'passed' | 'failed'
  executionMode: 'live' | 'demo'
  durationMs: number
  completedSteps: number
  totalSteps: number
  output: string
  error?: string
  artifacts: { name: string; url: string; type: string }[]
}

const appendOutput = (current: string, chunk: Buffer): string =>
  `${current}${chunk.toString('utf8')}`.slice(-outputLimit)

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const demoStepWeight: Record<ParsedRecording['steps'][number]['kind'], number> = {
  viewport: 0.5,
  navigate: 1.6,
  click: 1.2,
  fill: 1.3,
  press: 0.8,
  assert: 1.2,
  scroll: 0.7,
  unsupported: 0.5,
}

const demoTarget = (step: ParsedRecording['steps'][number]): string => {
  if (step.locator.kind === 'none') return 'the page'
  if (step.locator.kind === 'test-id') return `[data-testid="${step.locator.value}"]`
  return step.locator.value
}

const describeDemoStep = (
  step: ParsedRecording['steps'][number],
): { running: string; passed: string } => {
  switch (step.kind) {
    case 'viewport': {
      const size = `${step.viewport?.width ?? 1440} x ${step.viewport?.height ?? 900}`
      return { running: `Configuring browser viewport ${size}`, passed: `Configured browser viewport ${size}` }
    }
    case 'navigate': {
      const destination = step.url ? new URL(step.url).hostname : 'recorded destination'
      return { running: `Opening https://${destination}`, passed: `Navigated to ${destination}` }
    }
    case 'click': {
      const target = demoTarget(step)
      return { running: `Locating ${target}`, passed: `Clicked ${target}` }
    }
    case 'fill': {
      const target = demoTarget(step)
      const value = step.isSensitive ? '[protected value]' : `"${step.value ?? ''}"`
      return { running: `Entering ${value} in ${target}`, passed: `Entered ${value} in ${target}` }
    }
    case 'press':
      return { running: `Sending keyboard input ${step.key ?? 'key'}`, passed: `Pressed ${step.key ?? 'key'}` }
    case 'assert': {
      const target = demoTarget(step)
      return { running: `Checking visibility of ${target}`, passed: `Verified ${target} is visible` }
    }
    case 'scroll':
      return { running: 'Scrolling the page', passed: 'Scrolled the page' }
    case 'unsupported':
      return { running: `Reviewing ${step.sourceType}`, passed: `Reviewed ${step.sourceType}` }
  }
}

export const calculateDemoDuration = (stepCount: number, generatedLines: number): number =>
  clamp(10_000 + stepCount * 1_300 + generatedLines * 20, 15_000, 55_000)

const formatSeconds = (milliseconds: number): string => `${(milliseconds / 1000).toFixed(1)}s`

const runDemoJourney = async (
  id: string,
  recording: ParsedRecording,
): Promise<JourneyRunResult> => {
  const startedAt = Date.now()
  const generatedLines = generateProject(recording).lineCount
  const plannedDuration = process.env.NODE_ENV === 'test'
    ? recording.steps.length * 5
    : calculateDemoDuration(recording.steps.length, generatedLines)
  const totalWeight = recording.steps.reduce((total, step) => total + demoStepWeight[step.kind], 0)
  const lines = [
    'TESTPILOT DEMO SIMULATION',
    `Journey: ${recording.title}`,
    `Generated code: ${generatedLines} lines`,
    `Estimated duration: ${formatSeconds(plannedDuration)}`,
    'External browser calls: disabled',
    '',
  ]

  console.log(`\n[TestPilot Demo] ${recording.title}`)
  console.log(`[TestPilot Demo] Generated ${generatedLines} lines | Estimated ${formatSeconds(plannedDuration)}\n`)
  for (const [index, step] of recording.steps.entries()) {
    const number = `${String(index + 1).padStart(2, '0')}/${String(recording.steps.length).padStart(2, '0')}`
    const description = describeDemoStep(step)
    const stepDuration = Math.round((plannedDuration * demoStepWeight[step.kind]) / totalWeight)
    const runningLine = `[RUN ] Step ${number} - ${description.running}...`
    const passedLine = `[PASS] Step ${number} - ${description.passed} (${formatSeconds(stepDuration)})`
    lines.push(runningLine)
    console.log(runningLine)
    await wait(stepDuration)
    lines.push(passedLine)
    console.log(passedLine)
  }

  const durationMs = Date.now() - startedAt
  const resultLine = `RESULT: PASSED (${recording.steps.length}/${recording.steps.length} steps in ${formatSeconds(durationMs)})`
  lines.push('', resultLine)
  console.log(`\n[TestPilot Demo] PASSED ${recording.steps.length}/${recording.steps.length} in ${formatSeconds(durationMs)}\n`)

  return {
    id,
    status: 'passed',
    executionMode: 'demo',
    durationMs,
    completedSteps: recording.steps.length,
    totalSteps: recording.steps.length,
    output: `${lines.join('\n')}\n`,
    artifacts: [],
  }
}

const executePlaywright = (runDirectory: string, secret: string): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    if (!existsSync(playwrightCli)) {
      reject(new Error('Playwright is not installed. Run npm install before starting TestPilot.'))
      return
    }

    const child = spawn(
      process.execPath,
      [playwrightCli, 'test', '--config', path.join(runDirectory, 'playwright.config.ts'), '--workers=1'],
      {
        cwd: runDirectory,
        env: { ...process.env, TESTPILOT_SECRET: secret, PLAYWRIGHT_HTML_OPEN: 'never' },
        windowsHide: true,
      },
    )
    let output = ''
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 210_000)

    child.stdout.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, output, timedOut })
    })
  })

const collectFiles = async (directory: string): Promise<string[]> => {
  if (!existsSync(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(entryPath) : Promise.resolve([entryPath])
    }),
  )
  return files.flat()
}

const artifactType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.zip') return 'trace'
  if (extension === '.png') return 'screenshot'
  if (extension === '.webm') return 'video'
  return 'file'
}

const collectArtifacts = async (
  runDirectory: string,
): Promise<{ name: string; url: string; type: string }[]> => {
  const files = await collectFiles(path.join(runDirectory, 'test-results', 'artifacts'))
  return files.filter((filePath) => !path.basename(filePath).startsWith('.')).map((filePath) => {
    const relativePath = path.relative(runsDirectory, filePath)
    const url = `/artifacts/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`
    return { name: path.basename(filePath), url, type: artifactType(filePath) }
  })
}

type ReportStep = { title?: string; steps?: ReportStep[] }
type ReportSuite = {
  suites?: ReportSuite[]
  specs?: { tests?: { results?: { steps?: ReportStep[] }[] }[] }[]
}

const countMatchingSteps = (steps: ReportStep[], expectedTitles: Set<string>): number =>
  steps.reduce(
    (total, step) =>
      total + (step.title && expectedTitles.has(step.title) ? 1 : 0) + countMatchingSteps(step.steps ?? [], expectedTitles),
    0,
  )

const countCompletedSteps = async (
  runDirectory: string,
  recording: ParsedRecording,
  passed: boolean,
): Promise<number> => {
  if (passed) return recording.steps.length
  try {
    const report = JSON.parse(
      await readFile(path.join(runDirectory, 'test-results', 'results.json'), 'utf8'),
    ) as { suites?: ReportSuite[] }
    const expectedTitles = new Set(recording.steps.map((step) => step.title))
    const visitSuite = (suite: ReportSuite): number => {
      const ownSteps =
        suite.specs?.flatMap((spec) => spec.tests ?? []).flatMap((test) => test.results ?? []).flatMap((result) => result.steps ?? []) ?? []
      return countMatchingSteps(ownSteps, expectedTitles) + (suite.suites ?? []).reduce((total, child) => total + visitSuite(child), 0)
    }
    return Math.min(
      recording.steps.length,
      (report.suites ?? []).reduce((total, suite) => total + visitSuite(suite), 0),
    )
  } catch {
    return 0
  }
}

const removeOldRuns = async (): Promise<void> => {
  await mkdir(runsDirectory, { recursive: true })
  const entries = await readdir(runsDirectory, { withFileTypes: true })
  const directories = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        path: path.join(runsDirectory, entry.name),
        modified: (await stat(path.join(runsDirectory, entry.name))).mtimeMs,
      })),
  )
  const stale = directories.sort((left, right) => right.modified - left.modified).slice(12)
  await Promise.all(stale.map((entry) => rm(entry.path, { recursive: true, force: true })))
}

export const runJourney = async (
  recording: ParsedRecording,
  secret: string,
  options: GenerationOptions,
): Promise<JourneyRunResult> => {
  await removeOldRuns()
  const id = randomUUID().slice(0, 8)
  if (recording.executionMode === 'demo') return runDemoJourney(id, recording)

  const runDirectory = path.join(runsDirectory, id)
  const project = generateProject(recording, options)
  await mkdir(runDirectory, { recursive: true })

  await Promise.all(
    project.files.map(async (file) => {
      const filePath = path.join(runDirectory, file.path)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, file.content, 'utf8')
    }),
  )

  const startedAt = Date.now()
  const processResult = await executePlaywright(runDirectory, secret)
  const durationMs = Date.now() - startedAt
  const passed = processResult.exitCode === 0 && !processResult.timedOut
  const normalizedOutput = stripVTControlCharacters(processResult.output).replaceAll(projectRoot, '<project>')

  return {
    id,
    status: passed ? 'passed' : 'failed',
    executionMode: 'live',
    durationMs,
    completedSteps: await countCompletedSteps(runDirectory, recording, passed),
    totalSteps: recording.steps.length,
    output: normalizedOutput,
    error: processResult.timedOut ? 'Execution exceeded the 210 second local limit.' : undefined,
    artifacts: await collectArtifacts(runDirectory),
  }
}