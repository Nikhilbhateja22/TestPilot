import type { GenerationOptions } from '../src/lib/generator'
import type { LocatorCandidate, NormalizedStep, ParsedRecording } from '../src/lib/recorder'
import { runJourney } from './runner'
import type { JourneyRunResult } from './runner'

export type AgentAttempt = {
  number: number
  status: JourneyRunResult['status']
  durationMs: number
  completedSteps: number
  totalSteps: number
  evidence: string
  runId: string
}

export type AgentDiagnosis = {
  category: 'locator-drift'
  rootCause: string
  failedStepId: string
  failedStepTitle: string
  confidence: number
  decision: 'repair-and-retry'
}

export type AgentPatch = {
  stepId: string
  before: LocatorCandidate
  after: LocatorCandidate
  rationale: string
}

export type AgentRunResult = {
  status: 'recovered' | 'failed' | 'passed'
  recovered: boolean
  attempts: AgentAttempt[]
  diagnosis?: AgentDiagnosis
  patch?: AgentPatch
  finalRun: JourneyRunResult
}

type JourneyExecutor = (
  recording: ParsedRecording,
  secret: string,
  options: GenerationOptions,
) => Promise<JourneyRunResult>

const agentOptions: GenerationOptions = {
  trace: true,
  screenshot: true,
  video: false,
  testTimeoutMs: 12_000,
  expectTimeoutMs: 5_000,
  actionTimeoutMs: 5_000,
  navigationTimeoutMs: 8_000,
}

const evidenceFromRun = (run: JourneyRunResult): string => {
  const locatorLine = run.output.split('\n').find((line) => line.includes('waiting for'))?.trim()
  const timeoutLine = run.output.split('\n').find((line) => line.includes('Timeout'))?.trim()
  return locatorLine ?? timeoutLine ?? run.error ?? 'Playwright reported an execution failure.'
}

const toAttempt = (number: number, run: JourneyRunResult): AgentAttempt => ({
  number,
  status: run.status,
  durationMs: run.durationMs,
  completedSteps: run.completedSteps,
  totalSteps: run.totalSteps,
  evidence: run.status === 'passed' ? 'All Playwright steps completed.' : evidenceFromRun(run),
  runId: run.id,
})

const findFailedStep = (recording: ParsedRecording, output: string): NormalizedStep | undefined =>
  recording.steps.find((step) => output.includes(`› ${step.title}`))

const selectRepairCandidate = (step: NormalizedStep): LocatorCandidate | undefined =>
  step.alternatives.find(
    (candidate) => candidate.raw !== step.locator.raw && candidate.kind !== 'xpath' && candidate.score >= 70,
  )

const applyPatch = (recording: ParsedRecording, patch: AgentPatch): ParsedRecording => ({
  ...recording,
  steps: recording.steps.map((step) =>
    step.id === patch.stepId ? { ...step, locator: patch.after } : step,
  ),
})

export const runRepairAgent = async (
  recording: ParsedRecording,
  secret = '',
  execute: JourneyExecutor = runJourney,
): Promise<AgentRunResult> => {
  const firstRun = await execute(recording, secret, agentOptions)
  const attempts = [toAttempt(1, firstRun)]
  if (firstRun.status === 'passed') {
    return { status: 'passed', recovered: false, attempts, finalRun: firstRun }
  }

  const failedStep = findFailedStep(recording, firstRun.output)
  const repairCandidate = failedStep ? selectRepairCandidate(failedStep) : undefined
  if (!failedStep || !repairCandidate) {
    return { status: 'failed', recovered: false, attempts, finalRun: firstRun }
  }

  const diagnosis: AgentDiagnosis = {
    category: 'locator-drift',
    rootCause: `The selected ${failedStep.locator.kind} locator no longer resolves, while a recorded ${repairCandidate.kind} fallback remains available.`,
    failedStepId: failedStep.id,
    failedStepTitle: failedStep.title,
    confidence: repairCandidate.score / 100,
    decision: 'repair-and-retry',
  }
  const patch: AgentPatch = {
    stepId: failedStep.id,
    before: failedStep.locator,
    after: repairCandidate,
    rationale: `Use the ${repairCandidate.kind} fallback captured in the original Recorder evidence.`,
  }
  const repairedRun = await execute(applyPatch(recording, patch), secret, agentOptions)
  attempts.push(toAttempt(2, repairedRun))

  return {
    status: repairedRun.status === 'passed' ? 'recovered' : 'failed',
    recovered: repairedRun.status === 'passed',
    attempts,
    diagnosis,
    patch,
    finalRun: repairedRun,
  }
}